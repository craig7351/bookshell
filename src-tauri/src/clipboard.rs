use std::fs;
use std::io::BufWriter;

use arboard::{Clipboard, ImageData};
use uuid::Uuid;

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
