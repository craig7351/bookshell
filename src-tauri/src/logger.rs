/// Open an http(s) URL in the user's default browser. Restricted to those two
/// schemes so a malicious server can't trigger `file://` or custom-handler
/// invocations through the terminal's link-click hook.
#[tauri::command]
pub async fn url_open(url: String) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http(s) URLs allowed".into());
    }
    open_url(&url)
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> Result<(), String> {
    // `cmd /c start "" "<url>"` lets the shell pick the registered handler.
    // The empty "" is the window title slot — required when the URL is quoted.
    std::process::Command::new("cmd")
        .args(["/c", "start", "", url])
        .spawn()
        .map_err(|e| format!("start: {}", e))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn open_url(url: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd)
        .arg(url)
        .spawn()
        .map_err(|e| format!("{}: {}", cmd, e))?;
    Ok(())
}
