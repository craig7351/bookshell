use crate::config::config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    #[serde(default = "default_scrollback")]
    pub scrollback: u32,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_side_font_size")]
    pub side_font_size: u32,
    /// Git view auto-refresh polling interval in seconds (SSH sessions).
    #[serde(default = "default_git_poll_secs")]
    pub git_poll_secs: u32,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            scrollback: default_scrollback(),
            font_size: default_font_size(),
            side_font_size: default_side_font_size(),
            git_poll_secs: default_git_poll_secs(),
        }
    }
}

fn default_scrollback() -> u32 {
    10000
}
fn default_font_size() -> u32 {
    14
}
fn default_side_font_size() -> u32 {
    14
}
fn default_git_poll_secs() -> u32 {
    5
}

pub fn general_path() -> PathBuf {
    config_dir().join("general.toml")
}

pub fn load_general() -> GeneralSettings {
    let path = general_path();
    if !path.exists() {
        return GeneralSettings::default();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|t| toml::from_str(&t).ok())
        .unwrap_or_default()
}

pub fn save_general(settings: &GeneralSettings) -> Result<(), String> {
    let path = general_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let text = toml::to_string_pretty(settings).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[tauri::command]
pub async fn general_get() -> Result<GeneralSettings, String> {
    Ok(load_general())
}

#[tauri::command]
pub async fn general_set(settings: GeneralSettings) -> Result<(), String> {
    save_general(&settings)
}
