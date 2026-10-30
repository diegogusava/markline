// Built-in web server: lets a browser (for example a phone) use the editor on the files of this machine.
// Same protocol as server/server.js, so server/cli.js (open / poll / reply) works with either.
// Access is limited to one root folder and guarded by a token; plain HTTP, so use a trusted LAN or Tailscale.
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tiny_http::{Header, Method, Request, Response, Server};

const INDEX: &str = include_str!("../../dist/index.html");
const MARKED: &[u8] = include_bytes!("../../dist/vendor/marked.min.js");
const TURNDOWN: &[u8] = include_bytes!("../../dist/vendor/turndown.js");
const GFM: &[u8] = include_bytes!("../../dist/vendor/turndown-plugin-gfm.js");
const MAX_BODY: u64 = 5 * 1024 * 1024;

const SHIM: &str = r#"<script>
(function () {
  try {
    if (!localStorage.getItem('markline-folder-v1')) { localStorage.setItem('markline-folder-v1', __ROOT__); localStorage.setItem('markline-panel-v1', '1'); }
  } catch (e) { /* storage unavailable */ }
  async function call(cmd, args) {
    const r = await fetch('/api/' + cmd, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}) });
    const j = await r.json().catch(function () { return {}; });
    if (!r.ok) { if (r.status === 401) location.reload(); throw new Error(j.error || r.statusText); }
    return j.result;
  }
  window.__MARKLINE_WEB__ = true;
  window.__TAURI__ = { core: { invoke: async function (cmd, a) {
    a = a || {};
    if (cmd === 'initial_file') { const o = new URLSearchParams(location.search).get('open'); return o ? call('read_file', { path: o }) : null; }
    if (cmd === 'open_file') { const p = prompt('File to open (path relative to the shared folder):'); return p ? call('read_file', { path: p }) : null; }
    if (cmd === 'save_file' && !a.path) {
      const p = prompt('Save as (path relative to the shared folder):', a.suggested || 'untitled.md');
      if (!p) return null;
      a = Object.assign({}, a, { path: p });
    }
    return call(cmd, a);
  } } };
})();
</script>
"#;

#[derive(Serialize, Clone, Default)]
pub struct Info {
    pub running: bool,
    pub port: u16,
    pub lan: bool,
    pub token: String,
    pub root: String,
    pub urls: Vec<String>,
}

struct Batch {
    id: String,
    file: PathBuf,
    comments: Vec<Value>,
}

struct Queue {
    queue: VecDeque<Batch>,
    batches: HashMap<String, Batch>,
}

struct State {
    root: PathBuf,
    token: String,
    stopped: AtomicBool,
    allow_exit: bool,
    pollers: AtomicUsize,
    qs: Mutex<Queue>,
    cv: Condvar,
}

struct Running {
    server: Arc<Server>,
    state: Arc<State>,
    info: Info,
}

#[derive(Default)]
pub struct Web {
    inner: Mutex<Option<Running>>,
    /// headless `serve` mode: the `shutdown` API call may end the process
    pub exit_on_shutdown: AtomicBool,
}

struct E(u16, String);
fn fail<T>(code: u16, msg: &str) -> Result<T, E> { Err(E(code, msg.to_string())) }

// ---------- helpers ----------
fn ct_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() { return false; }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
fn new_token() -> String {
    let mut b = [0u8; 18];
    getrandom::getrandom(&mut b).expect("system random source");
    b.iter().map(|x| format!("{:02x}", x)).collect()
}
fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(v); i += 3; continue; }
                out.push(b'%'); i += 1;
            }
            b'+' => { out.push(b' '); i += 1; }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn pct_encode(s: &str) -> String {
    s.bytes().map(|c| if c.is_ascii_alphanumeric() || b"-_.~".contains(&c) { (c as char).to_string() } else { format!("%{:02X}", c) }).collect()
}
fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&').filter(|p| !p.is_empty()).map(|p| {
        let mut it = p.splitn(2, '=');
        (pct_decode(it.next().unwrap_or("")), pct_decode(it.next().unwrap_or("")))
    }).collect()
}
fn lower_ends(p: &Path, suffixes: &[&str]) -> bool {
    let s = p.to_string_lossy().to_lowercase();
    suffixes.iter().any(|x| s.ends_with(x))
}
fn is_text(p: &Path) -> bool { lower_ends(p, &[".md", ".markdown", ".txt"]) }
fn is_sidecar(p: &Path) -> bool { lower_ends(p, &[".md.comments.json", ".markdown.comments.json", ".txt.comments.json"]) }
fn is_notes(p: &Path) -> bool { lower_ends(p, &[".md.notes.md", ".markdown.notes.md", ".txt.notes.md"]) }
fn notes_base(p: &Path) -> PathBuf { let s = p.to_string_lossy(); PathBuf::from(&s[..s.len() - ".notes.md".len()]) }
fn name_of(p: &Path) -> String { p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default() }
fn mtime(p: &Path) -> f64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}
/// `canonicalize`, but without the `\\?\` prefix it adds on Windows, so paths read the way people write them
/// (C:\Users\..., not \\?\C:\Users\...). Every resolved path goes through here, so `starts_with` checks
/// compare like with like. The prefix stays on paths that need it: longer than Windows' 260-character limit.
pub fn real_path(p: &Path) -> std::io::Result<PathBuf> {
    let r = p.canonicalize()?;
    if !cfg!(windows) { return Ok(r); }
    Ok(match plain_windows(&r.to_string_lossy()) { Some(s) => PathBuf::from(s), None => r })
}
/// `\\?\C:\x` -> `C:\x` and `\\?\UNC\srv\share` -> `\\srv\share`; None when there is no prefix or it is needed
fn plain_windows(s: &str) -> Option<String> {
    let plain = if let Some(unc) = s.strip_prefix(r"\\?\UNC\") { format!(r"\\{}", unc) }
        else { let disk = s.strip_prefix(r"\\?\")?; if disk.as_bytes().get(1) != Some(&b':') { return None; } disk.to_string() };
    if plain.len() < 260 { Some(plain) } else { None }
}
fn sidecar_of(f: &Path) -> PathBuf { let mut s = f.as_os_str().to_owned(); s.push(".comments.json"); PathBuf::from(s) }

/// Resolve a client path against the root and refuse anything outside it (symlinks included).
fn resolve(root: &Path, p: &str, for_write: bool) -> Result<PathBuf, E> {
    let joined = root.join(if p.is_empty() { "." } else { p });
    let real = match real_path(&joined) {
        Ok(r) => r,
        Err(_) if for_write => {
            let parent = match joined.parent().and_then(|x| real_path(x).ok()) { Some(x) => x, None => return fail(404, "Folder not found") };
            match joined.file_name() { Some(n) => parent.join(n), None => return fail(403, "Bad path") }
        }
        Err(_) => return fail(404, &format!("Not found: {}", p)),
    };
    if !real.starts_with(root) { return fail(403, "Outside the allowed folder"); }
    Ok(real)
}

fn read_sidecar(f: &Path) -> Value {
    std::fs::read_to_string(sidecar_of(f)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())
        .filter(|v| v.get("comments").map_or(false, |c| c.is_array()))
        .unwrap_or_else(|| json!({"version": 1, "file": name_of(f), "comments": []}))
}
fn write_sidecar(f: &Path, d: &Value) -> Result<(), E> {
    let p = sidecar_of(f);
    let mut t = p.as_os_str().to_owned(); t.push(".tmp");
    let t = PathBuf::from(t);
    let text = serde_json::to_string_pretty(d).map_err(|e| E(500, e.to_string()))? + "\n";
    std::fs::write(&t, text).and_then(|_| std::fs::rename(&t, &p)).map_err(|e| E(500, e.to_string()))
}
fn comments_mut(d: &mut Value) -> &mut Vec<Value> { d["comments"].as_array_mut().expect("comments array") }
fn s<'a>(v: &'a Value, k: &str) -> &'a str { v.get(k).and_then(|x| x.as_str()).unwrap_or("") }

/// text of 1-based lines "A-B" (or "A") of a file
fn lines_of(f: &Path, spec: &str) -> Result<String, E> {
    let bad = || E(400, format!("Bad lines: {} (use A-B, 1-based)", spec));
    let (a, b) = spec.split_once('-').unwrap_or((spec, spec));
    let (a, b): (usize, usize) = (a.trim().parse().map_err(|_| bad())?, b.trim().parse().map_err(|_| bad())?);
    let text = std::fs::read_to_string(f).map_err(|e| E(500, e.to_string()))?;
    let all: Vec<&str> = text.lines().collect();
    if a == 0 || b < a || b > all.len() { return Err(bad()); }
    let q = all[a - 1..b].join("\n").trim().to_string();
    if q.is_empty() { return Err(bad()); }
    Ok(q)
}

/// keep only the comments of this batch that are still waiting for the agent
fn live_batch(b: &mut Batch) -> bool {
    let mut d = read_sidecar(&b.file);
    let live: Vec<String> = comments_mut(&mut d).iter()
        .filter(|c| s(c, "status") == "sent" && s(c, "batchId") == b.id).map(|c| s(c, "id").to_string()).collect();
    b.comments.retain(|c| live.iter().any(|i| i == s(c, "id")));
    !b.comments.is_empty()
}

// ---------- API ----------
fn api(st: &State, cmd: &str, a: &Value) -> Result<Value, E> {
    let path = |k: &str| a.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    match cmd {
        "ping" => Ok(json!({"ok": true})),
        "shutdown" => {
            if !st.allow_exit { return fail(400, "This server belongs to the desktop app. Stop it from the Share panel."); }
            std::thread::spawn(|| { std::thread::sleep(Duration::from_millis(200)); remove_state(); std::process::exit(0); });
            Ok(json!({"ok": true}))
        }
        "pick_folder" => Ok(json!(st.root.to_string_lossy())),
        "initial_file" => Ok(Value::Null),
        "list_dir" => {
            let dir = resolve(&st.root, &path("path"), false)?;
            let rd = std::fs::read_dir(&dir).map_err(|e| E(500, e.to_string()))?;
            let mut out: Vec<(bool, String, PathBuf)> = Vec::new();
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.starts_with('.') { continue; }
                let full = e.path();
                let is_dir = match std::fs::metadata(&full) { Ok(m) => m.is_dir(), Err(_) => continue };
                if is_dir { if matches!(name.as_str(), "node_modules" | "target" | "dist" | "build") { continue; } }
                else if !is_text(&full) { continue; }
                else if is_notes(&full) && notes_base(&full).is_file() { continue; }
                match real_path(&full) { Ok(r) if r.starts_with(&st.root) => {}, _ => continue }
                out.push((is_dir, name, full));
            }
            out.sort_by(|x, y| y.0.cmp(&x.0).then(x.1.to_lowercase().cmp(&y.1.to_lowercase())));
            Ok(Value::Array(out.into_iter().map(|(d, n, p)| json!({"name": n, "path": p.to_string_lossy(), "is_dir": d})).collect()))
        }
        "read_file" => {
            let f = resolve(&st.root, &path("path"), false)?;
            if !is_text(&f) { return fail(403, "Only markdown and text files can be opened"); }
            let text = std::fs::read_to_string(&f).map_err(|e| E(500, e.to_string()))?;
            Ok(json!({"path": f.to_string_lossy(), "name": name_of(&f), "text": text}))
        }
        "read_optional" => {
            let f = resolve(&st.root, &path("path"), true)?;
            if !is_sidecar(&f) && !is_text(&f) { return fail(403, "Not allowed"); }
            match std::fs::read_to_string(&f) { Ok(t) => Ok(json!(t)), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null), Err(e) => fail(500, &e.to_string()) }
        }
        "save_file" => {
            let text = match a.get("text").and_then(|x| x.as_str()) { Some(t) => t, None => return fail(400, "text required") };
            let f = resolve(&st.root, &path("path"), true)?;
            if !is_text(&f) && !is_sidecar(&f) { return fail(403, "Only .md, .markdown, .txt files can be saved"); }
            std::fs::write(&f, text).map_err(|e| E(500, e.to_string()))?;
            Ok(json!({"path": f.to_string_lossy(), "name": name_of(&f)}))
        }
        "delete_notes" => {
            let f = resolve(&st.root, &path("path"), true)?;
            if !is_notes(&f) { return fail(403, "Not a notes file"); }
            match std::fs::remove_file(&f) { Err(e) if e.kind() != std::io::ErrorKind::NotFound => fail(500, &e.to_string()), _ => Ok(Value::Null) }
        }
        "stat" => {
            let f = resolve(&st.root, &path("path"), true)?;
            Ok(json!({"file": mtime(&f), "sidecar": mtime(&sidecar_of(&f))}))
        }
        "send_batch" => {
            let f = resolve(&st.root, &path("path"), false)?;
            if !is_text(&f) { return fail(403, "Not allowed"); }
            let mut d = read_sidecar(&f);
            let id = format!("b{:x}", std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0));
            let mut sent = Vec::new();
            for c in comments_mut(&mut d).iter_mut() {
                if s(c, "status") == "open" {
                    c["status"] = json!("sent");
                    c["batchId"] = json!(id);
                    sent.push(json!({"id": c["id"], "startLine": c["startLine"], "endLine": c["endLine"], "quote": c["quote"], "comment": c["comment"]}));
                }
            }
            if sent.is_empty() { return fail(400, "No open comments to send"); }
            write_sidecar(&f, &d)?;
            let count = sent.len();
            let waiting = st.pollers.load(Ordering::SeqCst) > 0;
            let mut q = st.qs.lock().unwrap();
            let stored = Batch { id: id.clone(), file: f.clone(), comments: sent.clone() };
            q.batches.insert(id.clone(), stored);
            q.queue.push_back(Batch { id: id.clone(), file: f, comments: sent });
            drop(q);
            st.cv.notify_all();
            Ok(json!({"id": id, "count": count, "delivered": waiting}))
        }
        "reply" => {
            let batch = path("batch");
            let known = st.qs.lock().unwrap().batches.get(&batch).map(|b| b.file.clone());
            let f = match known {
                Some(f) if !batch.is_empty() => f,
                _ => {
                    if path("file").is_empty() { return fail(400, "Unknown batch; pass file"); }
                    resolve(&st.root, &path("file"), false)?
                }
            };
            let status = if path("status") == "resolved" { "resolved" } else { "applied" };
            let text = path("text");
            let (only, lines) = (path("comment"), path("lines"));
            if !lines.is_empty() && only.is_empty() { return fail(400, "lines needs comment"); }
            // the agent says which lines now hold the edited passage: that text becomes the comment's anchor
            let quote = if lines.is_empty() { None } else { Some(lines_of(&f, &lines)?) };
            let mut d = read_sidecar(&f);
            let mut n = 0;
            for c in comments_mut(&mut d).iter_mut() {
                if s(c, "status") != "sent" || (!batch.is_empty() && s(c, "batchId") != batch) || (!only.is_empty() && s(c, "id") != only) { continue; }
                c["status"] = json!(status);
                if !text.is_empty() { c["reply"] = json!(text); }
                if let Some(q) = &quote { c["was"] = c["quote"].clone(); c["quote"] = json!(q); }
                n += 1;
            }
            if n == 0 && !only.is_empty() { return fail(404, &format!("No comment {} is waiting for a reply", only)); }
            write_sidecar(&f, &d)?;
            Ok(json!({"updated": n}))
        }
        _ => fail(404, "Unknown command"),
    }
}

// ---------- HTTP ----------
fn hdr(name: &str, val: &str) -> Header { Header::from_bytes(name.as_bytes(), val.as_bytes()).unwrap() }
fn reply(req: Request, code: u16, body: Vec<u8>, ctype: &str, extra: Vec<Header>) {
    let mut r = Response::from_data(body).with_status_code(code)
        .with_header(hdr("Content-Type", ctype)).with_header(hdr("Cache-Control", "no-store"))
        .with_header(hdr("X-Content-Type-Options", "nosniff")).with_header(hdr("Referrer-Policy", "no-referrer"));
    for h in extra { r = r.with_header(h); }
    let _ = req.respond(r);
}
fn reply_json(req: Request, code: u16, v: Value) { reply(req, code, v.to_string().into_bytes(), "application/json", vec![]); }
fn header_of(req: &Request, name: &str) -> String {
    req.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string()).unwrap_or_default()
}
fn authed(st: &State, req: &Request) -> bool {
    let cookie = header_of(req, "Cookie");
    let c = cookie.split(';').map(|x| x.trim()).find_map(|x| x.strip_prefix("markline=")).map(pct_decode).unwrap_or_default();
    ct_eq(&c, &st.token) || ct_eq(&header_of(req, "x-markline-token"), &st.token)
}

fn handle(st: Arc<State>, mut req: Request) {
    let full = req.url().to_string();
    let (path, query) = match full.split_once('?') { Some((p, q)) => (p.to_string(), q.to_string()), None => (full.clone(), String::new()) };
    let q = parse_query(&query);
    let method = req.method().clone();

    if path == "/" {
        if let Some(t) = q.get("token") {
            if !ct_eq(t, &st.token) { return reply(req, 401, b"Wrong token".to_vec(), "text/plain; charset=utf-8", vec![]); }
            let loc = match q.get("open") { Some(o) => format!("/?open={}", pct_encode(o)), None => "/".to_string() };
            return reply(req, 302, vec![], "text/plain", vec![hdr("Location", &loc), hdr("Set-Cookie", &format!("markline={}; HttpOnly; SameSite=Strict; Path=/", st.token))]);
        }
    }
    if !authed(&st, &req) {
        return reply(req, 401, b"Open the shared URL from the desktop app (it contains ?token=...).".to_vec(), "text/plain; charset=utf-8", vec![]);
    }

    if method == Method::Post && path.starts_with("/api/") {
        if !header_of(&req, "Content-Type").starts_with("application/json") { return reply_json(req, 415, json!({"error": "JSON required"})); }
        let mut body = Vec::new();
        if req.as_reader().take(MAX_BODY + 1).read_to_end(&mut body).is_err() || body.len() as u64 > MAX_BODY {
            return reply_json(req, 413, json!({"error": "Body too large"}));
        }
        let args: Value = if body.is_empty() { json!({}) } else { match serde_json::from_slice(&body) { Ok(v) => v, Err(_) => return reply_json(req, 400, json!({"error": "Bad JSON"})) } };
        return match api(&st, &path[5..], &args) {
            Ok(v) => reply_json(req, 200, json!({"result": v})),
            Err(E(c, m)) => reply_json(req, c, json!({"error": m})),
        };
    }
    if method != Method::Get { return reply(req, 405, b"Method not allowed".to_vec(), "text/plain", vec![]); }

    match path.as_str() {
        "/" | "/index.html" => {
            let shim = SHIM.replace("__ROOT__", &json!(st.root.to_string_lossy()).to_string());
            let html = INDEX.replace("<div id=\"app\">", &format!("{}<div id=\"app\">", shim));
            reply(req, 200, html.into_bytes(), "text/html; charset=utf-8", vec![])
        }
        "/vendor/marked.min.js" => reply(req, 200, MARKED.to_vec(), "text/javascript", vec![]),
        "/vendor/turndown.js" => reply(req, 200, TURNDOWN.to_vec(), "text/javascript", vec![]),
        "/vendor/turndown-plugin-gfm.js" => reply(req, 200, GFM.to_vec(), "text/javascript", vec![]),
        "/api/poll" => poll(st, req, &q),
        "/file" => {
            let f = match resolve(&st.root, q.get("path").map(String::as_str).unwrap_or(""), false) { Ok(f) => f, Err(E(c, m)) => return reply_json(req, c, json!({"error": m})) };
            let ctype = match f.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
                Some("png") => "image/png", Some("jpg") | Some("jpeg") => "image/jpeg", Some("gif") => "image/gif",
                Some("webp") => "image/webp", Some("avif") => "image/avif", Some("bmp") => "image/bmp",
                _ => return reply(req, 403, b"Only images can be fetched".to_vec(), "text/plain", vec![]),
            };
            match std::fs::read(&f) { Ok(b) => reply(req, 200, b, ctype, vec![]), Err(_) => reply(req, 404, b"Not found".to_vec(), "text/plain", vec![]) }
        }
        _ => reply(req, 404, b"Not found".to_vec(), "text/plain", vec![]),
    }
}

/// Long poll, capped at 30 s per request (the CLI loops) so a dead poller never holds a batch for long.
fn poll(st: Arc<State>, req: Request, q: &HashMap<String, String>) {
    let want = match q.get("file").filter(|f| !f.is_empty()) {
        Some(f) => match resolve(&st.root, f, false) { Ok(p) => Some(p), Err(E(c, m)) => return reply_json(req, c, json!({"error": m})) },
        None => None,
    };
    let secs = q.get("timeout").and_then(|t| t.parse::<u64>().ok()).unwrap_or(30).clamp(1, 30);
    let deadline = Instant::now() + Duration::from_secs(secs);
    st.pollers.fetch_add(1, Ordering::SeqCst);
    let found = loop {
        let mut guard = st.qs.lock().unwrap();
        let pos = guard.queue.iter().position(|b| want.as_ref().map_or(true, |w| *w == b.file));
        if let Some(i) = pos {
            let mut b = guard.queue.remove(i).unwrap();
            drop(guard);
            if live_batch(&mut b) { break Some(b); }
            continue;
        }
        let now = Instant::now();
        if now >= deadline || st.stopped.load(Ordering::SeqCst) { break None; }
        let wait = (deadline - now).min(Duration::from_secs(1));
        let _ = st.cv.wait_timeout(guard, wait).unwrap();
    };
    st.pollers.fetch_sub(1, Ordering::SeqCst);
    match found {
        Some(b) => reply_json(req, 200, json!({"batch": {"id": b.id, "file": b.file.to_string_lossy(), "comments": b.comments}})),
        None => reply_json(req, 200, json!({"batch": Value::Null})),
    }
}

// ---------- lifecycle ----------
pub fn make_urls(port: u16, lan: bool, token: &str) -> Vec<String> {
    let mut urls = vec![format!("http://localhost:{}/?token={}", port, token)];
    if lan {
        if let Ok(ifs) = local_ip_address::list_afinet_netifas() {
            for (_, ip) in ifs {
                if let std::net::IpAddr::V4(v4) = ip { if !v4.is_loopback() && !v4.is_link_local() { urls.push(format!("http://{}:{}/?token={}", v4, port, token)); } }
            }
        }
    }
    urls
}
pub fn state_file() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".markline").join("server.json"))
}
fn write_state(info: &Info) {
    if let Some(p) = state_file() {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        let body = json!({"pid": std::process::id(), "port": info.port, "host": if info.lan { "0.0.0.0" } else { "127.0.0.1" }, "token": info.token, "root": info.root});
        if std::fs::write(&p, body.to_string()).is_ok() {
            #[cfg(unix)]
            { use std::os::unix::fs::PermissionsExt; let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600)); }
        }
    }
}
fn remove_state() { if let Some(p) = state_file() { let _ = std::fs::remove_file(p); } }

impl Web {
    pub fn status(&self) -> Info {
        self.inner.lock().unwrap().as_ref().map(|r| r.info.clone()).unwrap_or_default()
    }
    pub fn stop(&self) -> Info {
        if let Some(r) = self.inner.lock().unwrap().take() {
            r.state.stopped.store(true, Ordering::SeqCst);
            r.state.cv.notify_all();
            r.server.unblock();
            remove_state();
        }
        Info::default()
    }
    pub fn start(&self, root: String, port: u16, lan: bool, token: Option<String>) -> Result<Info, String> {
        self.stop();
        let root = real_path(Path::new(&root)).map_err(|e| format!("Cannot open folder: {}", e))?;
        if !root.is_dir() { return Err("The shared path is not a folder".into()); }
        let host = if lan { "0.0.0.0" } else { "127.0.0.1" };
        let server = Arc::new(Server::http((host, port)).map_err(|e| format!("Cannot listen on {}:{} ({})", host, port, e))?);
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
        let token = token.filter(|t| t.len() >= 16).unwrap_or_else(new_token);
        let urls = make_urls(port, lan, &token);
        let info = Info { running: true, port, lan, token: token.clone(), root: root.to_string_lossy().into_owned(), urls };
        let state = Arc::new(State {
            root, token, stopped: AtomicBool::new(false), allow_exit: self.exit_on_shutdown.load(Ordering::SeqCst), pollers: AtomicUsize::new(0),
            qs: Mutex::new(Queue { queue: VecDeque::new(), batches: HashMap::new() }), cv: Condvar::new(),
        });
        let (srv, st) = (server.clone(), state.clone());
        std::thread::spawn(move || {
            for req in srv.incoming_requests() {
                let st = st.clone();
                std::thread::spawn(move || handle(st, req));
            }
        });
        write_state(&info);
        *self.inner.lock().unwrap() = Some(Running { server, state, info: info.clone() });
        Ok(info)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(root: PathBuf) -> State {
        State {
            root, token: String::new(), stopped: AtomicBool::new(false), allow_exit: false, pollers: AtomicUsize::new(0),
            qs: Mutex::new(Queue { queue: VecDeque::new(), batches: HashMap::new() }), cv: Condvar::new(),
        }
    }

    #[test]
    fn reply_with_lines_anchors_the_comment_to_the_edited_text() {
        let dir = std::env::temp_dir().join(format!("markline-reply-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let doc = dir.join("doc.md");
        std::fs::write(&doc, "# Plan\n\n- The payments team owns retries.\n- Coupons stay.\n").unwrap();
        std::fs::write(dir.join("doc.md.comments.json"), json!({"version": 1, "file": "doc.md", "comments": [
            {"id": "c1", "status": "sent", "batchId": "b1", "quote": "Who owns the retry code?", "comment": "Name the team"},
            {"id": "c2", "status": "sent", "batchId": "b1", "quote": "Coupons stay.", "comment": "Why?"}
        ]}).to_string()).unwrap();
        let st = state(real_path(&dir).unwrap());

        api(&st, "reply", &json!({"file": doc.to_string_lossy(), "batch": "b1", "comment": "c1", "lines": "3-3", "text": "Named the team"})).unwrap_or_else(|E(_, m)| panic!("{}", m));

        let d = read_sidecar(&doc);
        let c = &d["comments"];
        assert_eq!(
            (s(&c[0], "status"), s(&c[0], "quote"), s(&c[0], "was"), s(&c[1], "status")),
            ("applied", "- The payments team owns retries.", "Who owns the retry code?", "sent")
        );
    }

    #[test]
    fn notes_save_read_hide_from_the_list_and_delete() {
        let dir = std::env::temp_dir().join(format!("markline-notes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("doc.md"), "# Doc\n").unwrap();
        std::fs::write(dir.join("meeting.notes.md"), "a file of its own\n").unwrap();
        let st = state(real_path(&dir).unwrap());
        let ok = |cmd: &str, a: Value| api(&st, cmd, &a).unwrap_or_else(|E(_, m)| panic!("{}", m));

        ok("save_file", json!({"path": "doc.md.notes.md", "text": "remember this"}));
        let names: Vec<String> = ok("list_dir", json!({"path": ""})).as_array().unwrap().iter().map(|e| s(e, "name").to_string()).collect();
        assert_eq!(names, vec!["doc.md", "meeting.notes.md"]);
        assert_eq!(ok("read_optional", json!({"path": "doc.md.notes.md"})), json!("remember this"));

        ok("delete_notes", json!({"path": "doc.md.notes.md"}));
        assert_eq!(ok("read_optional", json!({"path": "doc.md.notes.md"})), Value::Null);
        assert!(api(&st, "delete_notes", &json!({"path": "doc.md"})).is_err());
    }

    #[test]
    fn windows_paths_lose_the_verbatim_prefix() {
        assert_eq!(plain_windows(r"\\?\C:\Users\diego\notes.md").as_deref(), Some(r"C:\Users\diego\notes.md"));
        assert_eq!(plain_windows(r"\\?\UNC\nas\share\a.md").as_deref(), Some(r"\\nas\share\a.md"));
        assert_eq!(plain_windows(r"C:\Users\a.md"), None);
        assert_eq!(plain_windows(r"\\?\Volume{1234}\a.md"), None);
        let long = format!(r"\\?\C:\{}", "x".repeat(300));
        assert_eq!(plain_windows(&long), None);
    }
}
