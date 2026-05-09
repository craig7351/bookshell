mod buttons;
mod clipboard;
mod config;
mod general;
mod git;
mod git_watch;
mod local_pty;
mod logger;
mod ssh;
mod tabs;
mod webview;

use dashmap::DashMap;
use std::sync::Arc;
use tauri::Manager;

pub struct AppState {
    pub sessions: Arc<DashMap<String, ssh::SessionHandle>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let state = AppState {
        sessions: Arc::new(DashMap::new()),
    };

    tauri::Builder::default()
        .manage(state)
        .manage(git_watch::GitWatchState::new())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) = webview::configure(&window) {
                        log::warn!("WebView2 config failed: {}", e);
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ssh::ssh_connect,
            ssh::ssh_open_pty,
            local_pty::local_open_pty,
            ssh::ssh_write,
            ssh::ssh_resize,
            ssh::ssh_disconnect,
            ssh::ssh_upload_file,
            config::config_list_connections,
            config::config_save_connection,
            config::config_delete_connection,
            config::config_reorder_connections,
            logger::logger_open_dir,
            logger::logger_dir_path,
            logger::logs_list,
            logger::logs_read,
            logger::transcript_save_dialog,
            logger::url_open,
            ssh::ssh_log_path,
            buttons::buttons_list,
            buttons::buttons_save,
            buttons::buttons_delete,
            buttons::buttons_reorder,
            clipboard::clipboard_save_image,
            general::general_get,
            general::general_set,
            tabs::tabs_load_state,
            tabs::tabs_save_state,
            git::session_exec_capture,
            git::git_view,
            git_watch::git_watch_start,
            git_watch::git_watch_stop,
            git::git_diff,
            git::git_show,
            git::git_show_untracked,
            git::git_commit_detail,
            git::git_commit_file_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
