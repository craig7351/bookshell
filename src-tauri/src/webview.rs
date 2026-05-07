#[cfg(target_os = "windows")]
pub fn configure(window: &tauri::WebviewWindow) -> Result<(), String> {
    use std::sync::{Arc, Mutex};
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows::core::Interface;

    let inner_err: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let inner_err_clone = inner_err.clone();

    window
        .with_webview(move |webview| {
            let mut slot = inner_err_clone.lock().unwrap();
            unsafe {
                let core = match webview.controller().CoreWebView2() {
                    Ok(c) => c,
                    Err(e) => {
                        *slot = Some(format!("CoreWebView2: {:?}", e));
                        return;
                    }
                };
                let settings = match core.Settings() {
                    Ok(s) => s,
                    Err(e) => {
                        *slot = Some(format!("Settings: {:?}", e));
                        return;
                    }
                };
                let s3: ICoreWebView2Settings3 = match settings.cast() {
                    Ok(s) => s,
                    Err(e) => {
                        *slot = Some(format!("cast Settings3: {:?}", e));
                        return;
                    }
                };
                if let Err(e) = s3.SetAreBrowserAcceleratorKeysEnabled(false) {
                    *slot = Some(format!("SetAreBrowserAcceleratorKeysEnabled: {:?}", e));
                }
            }
        })
        .map_err(|e| format!("with_webview: {:?}", e))?;

    if let Some(e) = inner_err.lock().unwrap().take() {
        return Err(e);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn configure(_window: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}
