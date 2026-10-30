// Command line mode of the same binary, so a coding agent can drive the review loop without a window or Node:
//   markline serve [--root DIR] [--port N] [--lan] [--token T]   headless web server (runs until `stop`)
//   markline open FILE.md [--lan] [--port N] [--no-open]          start a server if none runs, print the link
//   markline poll [--file F] [--timeout SECS] [--json]            wait for comments sent from the browser
//   markline reply [--batch ID] [--comment ID --lines A-B] [--resolved] "what you changed"   answer them in the browser
//   markline status | stop
use crate::web::{self, Web};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

struct Args { pos: Vec<String>, flags: std::collections::HashMap<String, String> }
fn parse(a: &[String]) -> Args {
    let boolean = ["lan", "no-open", "json", "resolved"];
    let (mut pos, mut flags) = (Vec::new(), std::collections::HashMap::new());
    let mut i = 0;
    while i < a.len() {
        if let Some(k) = a[i].strip_prefix("--") {
            if !boolean.contains(&k) && i + 1 < a.len() { flags.insert(k.to_string(), a[i + 1].clone()); i += 1; }
            else { flags.insert(k.to_string(), "1".into()); }
        } else { pos.push(a[i].clone()); }
        i += 1;
    }
    Args { pos, flags }
}
fn err(msg: &str) -> i32 { eprintln!("{}", msg); 1 }

struct Srv { port: u16, token: String, root: PathBuf, host: String }
fn read_state() -> Option<Srv> {
    let v: Value = serde_json::from_str(&std::fs::read_to_string(web::state_file()?).ok()?).ok()?;
    Some(Srv { port: v["port"].as_u64()? as u16, token: v["token"].as_str()?.to_string(), root: PathBuf::from(v["root"].as_str()?), host: v["host"].as_str().unwrap_or("127.0.0.1").to_string() })
}

/// minimal HTTP/1.1 client for the local server
fn http(s: &Srv, method: &str, path: &str, body: Option<&Value>, timeout: Duration) -> Result<Value, String> {
    let mut c = TcpStream::connect(("127.0.0.1", s.port)).map_err(|e| e.to_string())?;
    c.set_read_timeout(Some(timeout)).ok(); c.set_write_timeout(Some(Duration::from_secs(10))).ok();
    let b = body.map(|b| b.to_string()).unwrap_or_default();
    let req = format!("{} {} HTTP/1.1\r\nHost: localhost\r\nx-markline-token: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", method, path, s.token, b.len(), b);
    c.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
    let mut raw = Vec::new();
    c.read_to_end(&mut raw).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&raw).into_owned();
    let (head, rest) = text.split_once("\r\n\r\n").ok_or("bad response")?;
    let code: u16 = head.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
    let v: Value = serde_json::from_str(rest).unwrap_or_else(|_| json!({"error": rest}));
    if code >= 400 || code == 0 { return Err(v["error"].as_str().unwrap_or("request failed").to_string()); }
    Ok(v)
}
fn alive() -> Option<Srv> {
    let s = read_state()?;
    http(&s, "POST", "/api/ping", Some(&json!({})), Duration::from_secs(2)).ok()?;
    Some(s)
}
fn need_server() -> Result<Srv, i32> {
    alive().ok_or_else(|| err("No Markline server is running. Start one with: markline open FILE.md (or press Share in the app)."))
}
fn me() -> String { std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "markline".into()) }

const USAGE: &str = "Usage: markline [FILE.md | DIR]      open the desktop app (a folder opens in the sidebar)
       markline serve [--root DIR] [--port N] [--lan] [--token T]
       markline open FILE.md [--lan] [--port N] [--no-open]
       markline poll [--file F] [--timeout SECS] [--json]
       markline reply [--batch ID] [--comment ID --lines A-B] [--resolved] \"what you changed\"
       markline status | stop";

pub fn run(argv: Vec<String>) -> Option<i32> {
    let cmd = argv.get(1)?.as_str();
    if matches!(cmd, "help" | "--help" | "-h") { println!("{}", USAGE); return Some(0); }
    if !["serve", "open", "poll", "reply", "status", "stop"].contains(&cmd) { return None; }
    let a = parse(&argv[2..]);
    Some(match cmd {
        "serve" => serve(&a),
        "open" => open(&a),
        "poll" => poll(&a),
        "reply" => reply(&a),
        "status" => match alive() {
            Some(s) => { println!("running on port {} serving {}", s.port, s.root.display()); for u in web::make_urls(s.port, s.host == "0.0.0.0", &s.token) { println!("{}", u); } 0 }
            None => { println!("not running"); 0 }
        },
        _ => match alive() {
            None => { println!("not running"); 0 }
            Some(s) => match http(&s, "POST", "/api/shutdown", Some(&json!({})), Duration::from_secs(5)) { Ok(_) => { println!("stopped"); 0 } Err(e) => err(&e) },
        },
    })
}

fn serve(a: &Args) -> i32 {
    let root = a.flags.get("root").cloned().unwrap_or_else(|| ".".into());
    let port: u16 = a.flags.get("port").and_then(|p| p.parse().ok()).unwrap_or(8080);
    let w = Web::default();
    w.exit_on_shutdown.store(true, Ordering::SeqCst);
    match w.start(root, port, a.flags.contains_key("lan"), a.flags.get("token").cloned()) {
        Ok(info) => {
            println!("Serving {}", info.root);
            for u in &info.urls { println!("{}", u); }
            loop { std::thread::sleep(Duration::from_secs(3600)); }
        }
        Err(e) => err(&e),
    }
}

fn open(a: &Args) -> i32 {
    let arg = match a.pos.first() { Some(p) => p, None => return err("Usage: markline open FILE.md") };
    let file = match web::real_path(Path::new(arg)) { Ok(f) => f, Err(e) => return err(&format!("{}: {}", arg, e)) };
    let mut st = alive();
    if let Some(s) = &st {
        if !file.starts_with(&s.root) { return err(&format!("The running server only serves {}, which does not contain {}. Stop it (markline stop) or open a file inside that folder.", s.root.display(), file.display())); }
    } else {
        let dir = a.flags.get("root").map(PathBuf::from).unwrap_or_else(|| file.parent().unwrap_or(Path::new(".")).to_path_buf());
        let mut cmd = std::process::Command::new(me());
        cmd.arg("serve").arg("--root").arg(&dir);
        if let Some(p) = a.flags.get("port") { cmd.arg("--port").arg(p); }
        if a.flags.contains_key("lan") { cmd.arg("--lan"); }
        cmd.stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
        #[cfg(unix)]
        { use std::os::unix::process::CommandExt; cmd.process_group(0); }
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0000_0008 | 0x0000_0200); }
        let _ = std::fs::remove_file(web::state_file().unwrap_or_default());
        if let Err(e) = cmd.spawn() { return err(&format!("Could not start the server: {}", e)); }
        let end = Instant::now() + Duration::from_secs(8);
        while st.is_none() && Instant::now() < end { std::thread::sleep(Duration::from_millis(100)); st = alive(); }
    }
    let s = match st { Some(s) => s, None => return err("The server did not start. Try: markline serve --root DIR") };
    let rel = file.strip_prefix(&s.root).unwrap().to_string_lossy().replace('\\', "/");
    let suffix = format!("&open={}", rel.bytes().map(|c| if c.is_ascii_alphanumeric() || b"-_.~/".contains(&c) { (c as char).to_string() } else { format!("%{:02X}", c) }).collect::<String>());
    let urls = web::make_urls(s.port, s.host == "0.0.0.0", &s.token);
    for u in &urls { println!("{}{}", u, suffix); }
    println!("\nNext: run `{} poll` and wait for comments from the browser.", me());
    let show = !a.flags.contains_key("no-open") && (cfg!(not(target_os = "linux")) || std::env::var_os("DISPLAY").is_some() || std::env::var_os("WAYLAND_DISPLAY").is_some());
    if show {
        let u = format!("{}{}", urls[0], suffix);
        let _ = if cfg!(target_os = "macos") { std::process::Command::new("open").arg(&u).spawn() }
            else if cfg!(windows) { std::process::Command::new("cmd").args(["/c", "start", "", &u]).spawn() }
            else { std::process::Command::new("xdg-open").arg(&u).spawn() };
    }
    0
}

/// Desktop "Send to agent": queue the file's open comments on the server `poll` waits on, starting one in the file's folder if none runs.
pub fn send(w: &Web, path: &str) -> Result<Value, String> {
    let file = web::real_path(Path::new(path)).map_err(|e| format!("{}: {}", path, e))?;
    let s = match alive() {
        Some(s) => s,
        None => {
            w.start(file.parent().unwrap_or(Path::new(".")).to_string_lossy().into_owned(), 0, false, None)?;
            alive().ok_or("The Markline server did not start.")?
        }
    };
    if !file.starts_with(&s.root) { return Err(format!("The running Markline server only serves {}. Stop it (markline stop) or open a file inside that folder.", s.root.display())); }
    Ok(http(&s, "POST", "/api/send_batch", Some(&json!({"path": file})), Duration::from_secs(10))?["result"].clone())
}

fn poll(a: &Args) -> i32 {
    let s = match need_server() { Ok(s) => s, Err(c) => return c };
    let secs: u64 = a.flags.get("timeout").and_then(|t| t.parse().ok()).unwrap_or(600);
    let end = Instant::now() + Duration::from_secs(secs);
    let fq = a.flags.get("file").and_then(|f| web::real_path(Path::new(f)).ok()).map(|p| format!("&file={}", p.to_string_lossy().bytes().map(|c| if c.is_ascii_alphanumeric() || b"-_.~/".contains(&c) { (c as char).to_string() } else { format!("%{:02X}", c) }).collect::<String>())).unwrap_or_default();
    let mut batch = Value::Null;
    while batch.is_null() && Instant::now() < end {
        let chunk = (end - Instant::now()).as_secs().clamp(1, 10);
        match http(&s, "GET", &format!("/api/poll?timeout={}{}", chunk, fq), None, Duration::from_secs(chunk + 15)) {
            Ok(v) => batch = v["batch"].clone(),
            Err(e) => return err(&format!("Poll failed: {}", e)),
        }
    }
    if batch.is_null() { println!("No comments yet. Run `{} poll` again to keep waiting.", me()); return 0; }
    if a.flags.contains_key("json") { println!("{}", serde_json::to_string_pretty(&batch).unwrap()); return 0; }
    let id = batch["id"].as_str().unwrap_or("");
    println!("Review comments for {}  (batch {})\n", batch["file"].as_str().unwrap_or(""), id);
    println!("Edit the file in place. Change only what each comment needs and keep everything else exactly as is (front matter, tables, code fences, mermaid blocks). If a comment is a question, do not edit; answer it in your reply.\n");
    for (i, c) in batch["comments"].as_array().cloned().unwrap_or_default().iter().enumerate() {
        let (l1, l2) = (c["startLine"].as_u64(), c["endLine"].as_u64());
        let loc = match (l1, l2) { (Some(x), Some(y)) if x == y => format!("Line {}", x), (Some(x), Some(y)) => format!("Lines {}-{}", x, y), _ => "Location unknown".into() };
        println!("{}. [{}] {}, passage:", i + 1, c["id"].as_str().unwrap_or(""), loc);
        println!("   > {}", c["quote"].as_str().unwrap_or("").replace('\n', "\n   > "));
        println!("   Comment: {}\n", c["comment"].as_str().unwrap_or("").replace('\n', "\n   "));
    }
    println!("When finished, reply once per comment with the lines that now hold the edited passage (1-based, in the saved file):");
    println!("  {} reply --batch {} --comment <ID> --lines <A-B> \"<what you changed>\"", me(), id);
    println!("For a comment you answered without editing, leave out --lines. To answer all at once: {} reply --batch {} \"<summary>\"", me(), id);
    println!("Then run `{} poll` again to wait for the next round.", me());
    0
}

fn reply(a: &Args) -> i32 {
    let s = match need_server() { Ok(s) => s, Err(c) => return c };
    let text = a.pos.join(" ");
    let resolved = a.flags.contains_key("resolved");
    if text.is_empty() && !resolved { return err("Usage: markline reply [--batch ID] [--file F] [--comment ID --lines A-B] [--resolved] \"what you changed\""); }
    let file = a.flags.get("file").and_then(|f| web::real_path(Path::new(f)).ok()).map(|p| p.to_string_lossy().into_owned());
    let body = json!({"batch": a.flags.get("batch"), "file": file, "comment": a.flags.get("comment"), "lines": a.flags.get("lines"), "text": text, "status": if resolved { "resolved" } else { "applied" }});
    match http(&s, "POST", "/api/reply", Some(&body), Duration::from_secs(10)) {
        Ok(v) => { println!("Replied; {} comment(s) marked {}.", v["result"]["updated"], if resolved { "resolved" } else { "applied" }); 0 }
        Err(e) => err(&format!("Reply failed: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_send_starts_a_server_and_queues_the_open_comments_for_poll() {
        let dir = std::env::temp_dir().join(format!("markline-send-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("HOME", &dir);
        let doc = dir.join("doc.md");
        std::fs::write(&doc, "# Title\n").unwrap();
        std::fs::write(dir.join("doc.md.comments.json"), json!({"version": 1, "file": "doc.md", "comments": [
            {"id": "c1", "status": "open", "startLine": 1, "endLine": 1, "quote": "Title", "comment": "rename"}
        ]}).to_string()).unwrap();

        let sent = send(&Web::default(), &doc.to_string_lossy()).unwrap();

        let s = alive().unwrap();
        let got = http(&s, "GET", "/api/poll?timeout=1", None, Duration::from_secs(5)).unwrap();
        assert_eq!((sent["count"].clone(), got["batch"]["comments"][0]["comment"].clone()), (json!(1), json!("rename")));
    }

    #[test]
    fn help_flag_prints_usage_instead_of_opening_the_app() {
        for flag in ["--help", "-h", "help"] {
            assert_eq!(run(vec!["markline".into(), flag.into()]), Some(0));
        }
    }
}
