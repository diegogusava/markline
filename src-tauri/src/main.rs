#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod cli;
mod web;
use serde::Serialize;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
struct Opened { path: String, name: String, text: String }
#[derive(Serialize)]
struct Saved { path: String, name: String }

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "untitled.md".into())
}
fn read(p: &Path) -> Result<Opened, String> {
    let text = std::fs::read_to_string(p).map_err(|e| e.to_string())?;
    Ok(Opened { path: p.to_string_lossy().into_owned(), name: file_name(p), text })
}

#[tauri::command]
fn open_file(app: tauri::AppHandle) -> Result<Option<Opened>, String> {
    let pick = app.dialog().file().add_filter("Markdown", &["md", "markdown", "txt"]).blocking_pick_file();
    match pick {
        Some(fp) => { let p = fp.into_path().map_err(|e| e.to_string())?; read(&p).map(Some) }
        None => Ok(None),
    }
}

#[tauri::command]
fn save_file(app: tauri::AppHandle, path: Option<String>, suggested: String, text: String) -> Result<Option<Saved>, String> {
    let target = match path {
        Some(p) => Path::new(&p).to_path_buf(),
        None => {
            let pick = app.dialog().file().add_filter("Markdown", &["md", "markdown"]).set_file_name(&suggested).blocking_save_file();
            match pick { Some(fp) => fp.into_path().map_err(|e| e.to_string())?, None => return Ok(None) }
        }
    };
    std::fs::write(&target, text).map_err(|e| e.to_string())?;
    Ok(Some(Saved { path: target.to_string_lossy().into_owned(), name: file_name(&target) }))
}

#[derive(Serialize)]
struct Entry { name: String, path: String, is_dir: bool }

#[tauri::command]
fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match app.dialog().file().blocking_pick_folder() {
        Some(fp) => Ok(Some(fp.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned())),
        None => Ok(None),
    }
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = Vec::new();
    for e in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let e = match e { Ok(e) => e, Err(_) => continue };
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') { continue; }
        let p = e.path();
        let is_dir = p.is_dir();
        if is_dir {
            if matches!(name.as_str(), "node_modules" | "target" | "dist" | "build") { continue; }
        } else {
            let ext = p.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !matches!(ext.as_str(), "md" | "markdown" | "txt") { continue; }
        }
        out.push(Entry { name, path: p.to_string_lossy().into_owned(), is_dir });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

#[tauri::command]
fn read_file(path: String) -> Result<Opened, String> { read(Path::new(&path)) }

#[tauri::command]
fn read_optional(path: String) -> Result<Option<String>, String> {
    match std::fs::read_to_string(&path) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Serialize)]
struct Stat { file: f64, sidecar: f64 }

fn mtime(p: &Path) -> f64 {
    std::fs::metadata(p).and_then(|m| m.modified()).ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

#[tauri::command]
fn stat(path: String) -> Stat {
    Stat { file: mtime(Path::new(&path)), sidecar: mtime(Path::new(&format!("{}.comments.json", path))) }
}

#[tauri::command]
fn web_start(state: tauri::State<web::Web>, root: String, port: u16, lan: bool, token: Option<String>) -> Result<web::Info, String> {
    state.start(root, port, lan, token)
}
#[tauri::command]
fn web_stop(state: tauri::State<web::Web>) -> web::Info { state.stop() }
#[tauri::command]
fn web_status(state: tauri::State<web::Web>) -> web::Info { state.status() }

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:")) { return Err("Unsupported link".into()); }
    #[cfg(target_os = "windows")]
    let mut cmd = { let mut c = std::process::Command::new("cmd"); c.args(["/C", "start", ""]); c };
    #[cfg(target_os = "macos")]
    let mut cmd = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn initial_file() -> Option<Opened> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    read(Path::new(&arg)).ok()
}

fn main() {
    // `markline serve|open|poll|reply|status|stop` runs without a window
    if let Some(code) = cli::run(std::env::args().collect()) { std::process::exit(code); }
    tauri::Builder::default()
        .manage(web::Web::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_file, save_file, initial_file, pick_folder, list_dir, read_file, read_optional, stat, web_start, web_stop, web_status, open_url])
        .run(tauri::generate_context!())
        .expect("error while running Markline");
}
