// Sem janela de console no Windows em release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::ipc::Response;

/// Caminho do PDF passado na linha de comando ("Abrir com…" ou arrastar
/// sobre o .exe). Lido uma vez na inicialização.
struct Startup(Option<String>);

fn has_ext(path: &Path, ext: &str) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

fn err(path: &Path, e: std::io::Error) -> String {
    format!("{}: {}", path.display(), e)
}

/// Lê um PDF e devolve os bytes crus (chega ao JS como ArrayBuffer,
/// sem serializar em JSON).
#[tauri::command]
fn read_pdf(path: String) -> Result<Response, String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, "pdf") {
        return Err("Só arquivos .pdf podem ser abertos.".into());
    }
    fs::read(&p).map(Response::new).map_err(|e| err(&p, e))
}

/// Lê um arquivo de marcações. `None` se ele não existir.
#[tauri::command]
fn read_marks(path: String) -> Result<Option<String>, String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, "json") {
        return Err("Marcações precisam ser .json.".into());
    }
    match fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(&p, e)),
    }
}

/// Grava de forma atômica: escreve um temporário ao lado e renomeia por
/// cima. Uma queda no meio não corrompe o arquivo anterior.
fn write_atomic(p: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut tmp = p.to_path_buf().into_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    let write = || -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, p)
    };
    write().map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(p, e)
    })
}

#[tauri::command]
fn write_marks(path: String, contents: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !has_ext(&p, "json") {
        return Err("Marcações precisam ser .json.".into());
    }
    write_atomic(&p, contents.as_bytes())
}

/// Decodifica %XX (o caminho chega num cabeçalho, que só aceita ASCII).
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Grava um PDF gerado na janela de montagem. Os bytes chegam crus no corpo
/// da chamada (sem JSON) e o caminho no cabeçalho `path`.
#[tauri::command]
fn write_pdf(request: tauri::ipc::Request) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("Conteúdo inválido.".into());
    };
    let path = request
        .headers()
        .get("path")
        .and_then(|v| v.to_str().ok())
        .and_then(percent_decode)
        .ok_or("Caminho ausente.")?;
    let p = PathBuf::from(path);
    if !has_ext(&p, "pdf") {
        return Err("O arquivo final precisa ser .pdf.".into());
    }
    write_atomic(&p, data)
}

#[tauri::command]
fn startup_file(state: tauri::State<Startup>) -> Option<String> {
    state.0.clone()
}

fn main() {
    let startup = std::env::args()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| has_ext(p, "pdf") && p.is_file())
        .map(|p| p.to_string_lossy().into_owned());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Startup(startup))
        .invoke_handler(tauri::generate_handler![
            read_pdf,
            read_marks,
            write_marks,
            write_pdf,
            startup_file
        ])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar o LiminalPDF");
}
