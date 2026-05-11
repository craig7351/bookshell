use std::fs;
use std::io::BufWriter;
use std::sync::OnceLock;
use std::sync::mpsc;

use arboard::{Clipboard, ImageData};
use uuid::Uuid;

// Persistent clipboard worker: holds a Clipboard instance alive so X11 keeps
// responding to SelectionRequest events. Without this, Clipboard drops at the
// end of each command → X11 releases ownership → clipboard content is lost.
struct ClipboardWorker {
    tx: mpsc::SyncSender<String>,
}

static CLIPBOARD_WORKER: OnceLock<ClipboardWorker> = OnceLock::new();

fn get_clipboard_worker() -> &'static ClipboardWorker {
    CLIPBOARD_WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::sync_channel::<String>(4);
        std::thread::Builder::new()
            .name("clipboard-writer".into())
            .spawn(move || {
                let mut cb = match Clipboard::new() {
                    Ok(c) => c,
                    Err(e) => {
                        log::error!("clipboard worker init failed: {e}");
                        return;
                    }
                };
                while let Ok(text) = rx.recv() {
                    if let Err(e) = cb.set_text(&text) {
                        log::warn!("clipboard set_text failed: {e}");
                    }
                }
            })
            .ok();
        ClipboardWorker { tx }
    })
}

/// Write plain text to the system clipboard via a persistent arboard worker
/// thread. Avoids WebKitGTK clipboard API hangs and X11 focus-stealing from
/// repeated Clipboard::new() calls.
#[tauri::command]
pub fn clipboard_write_text(text: String) -> Result<(), String> {
    get_clipboard_worker()
        .tx
        .send(text)
        .map_err(|e| format!("clipboard write: {e}"))
}

/// Read plain text from the system clipboard. Returns None when empty.
#[tauri::command]
pub fn clipboard_read_text() -> Result<Option<String>, String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard open: {e}"))?;
    match cb.get_text() {
        Ok(t) if !t.is_empty() => Ok(Some(t)),
        _ => Ok(None),
    }
}

/// Read the system clipboard. If it contains a usable image and no text takes
/// priority, encode it as PNG into the OS temp dir and return the absolute
/// path. If the clipboard holds text (even alongside an image), return None
/// so the caller can fall back to a normal text paste.
#[tauri::command]
pub fn clipboard_save_image() -> Result<Option<String>, String> {
    let mut cb = Clipboard::new().map_err(|e| format!("clipboard open: {e}"))?;

    if let Ok(text) = cb.get_text() {
        if !text.is_empty() {
            return Ok(None);
        }
    }

    let img: ImageData = match cb.get_image() {
        Ok(i) => i,
        Err(_) => return Ok(None),
    };

    let dir = std::env::temp_dir().join("bookshell-clipboard");
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;

    let path = dir.join(format!("clip-{}.png", Uuid::new_v4()));
    let file = fs::File::create(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
    let w = BufWriter::new(file);

    let mut encoder = png::Encoder::new(w, img.width as u32, img.height as u32);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| format!("png header: {e}"))?;
    writer
        .write_image_data(&img.bytes)
        .map_err(|e| format!("png encode: {e}"))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}
