//! Windows portable self-update: download the release's portable exe, then
//! hand off to a hidden PowerShell script that waits for this process to exit,
//! swaps the exe in place and relaunches it.

#[tauri::command]
pub async fn self_update_portable(tag: String) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = tag;
        Err("portable self-update is Windows-only".into())
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let version = tag.trim_start_matches('v');
        if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Err("invalid version tag".into());
        }
        let url = format!(
            "https://github.com/craig7351/bookshell/releases/download/v{0}/BOOKSHELL_{0}_x64-portable.exe",
            version
        );
        let current = std::env::current_exe().map_err(|e| e.to_string())?;
        let tmp = std::env::temp_dir().join(format!("bookshell-update-{}.exe", version));

        // 1) Download (blocking, off the async runtime). Failure is reported to the UI.
        let dl_url = url.clone();
        let dl_tmp = tmp.clone();
        tokio::task::spawn_blocking(move || {
            let script = format!(
                "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri '{}' -OutFile '{}'",
                dl_url,
                dl_tmp.display()
            );
            let out = std::process::Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-Command", &script])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("powershell: {}", e))?;
            if !out.status.success() {
                return Err(format!(
                    "download failed: {}",
                    String::from_utf8_lossy(&out.stderr).trim()
                ));
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())??;

        let size = std::fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        if size < 1_000_000 {
            let _ = std::fs::remove_file(&tmp);
            return Err("downloaded file is too small, aborting".into());
        }

        // 2) Detached swap-and-relaunch script.
        let script = format!(
            "$p={pid}; try {{ Wait-Process -Id $p -Timeout 60 -ErrorAction SilentlyContinue }} catch {{}}; \
             for($i=0;$i -lt 40;$i++){{ try {{ Copy-Item -LiteralPath '{src}' -Destination '{dst}' -Force -ErrorAction Stop; break }} catch {{ Start-Sleep -Milliseconds 500 }} }}; \
             Remove-Item -LiteralPath '{src}' -Force -ErrorAction SilentlyContinue; \
             Start-Process -FilePath '{dst}'",
            pid = std::process::id(),
            src = tmp.display(),
            dst = current.display()
        );
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("spawn updater: {}", e))?;
        Ok(())
    }
}
