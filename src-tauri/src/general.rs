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
    #[serde(default)]
    pub terminal_font_family: Option<String>,
    #[serde(default)]
    pub terminal_palette: Option<String>,
    #[serde(default)]
    pub terminal_foreground: Option<String>,
    #[serde(default)]
    pub terminal_background: Option<String>,
    /// Where the tab strip lives: "left" (vertical sidebar) or "top" (in the header).
    #[serde(default = "default_tab_position")]
    pub tab_position: String,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            scrollback: default_scrollback(),
            font_size: default_font_size(),
            side_font_size: default_side_font_size(),
            git_poll_secs: default_git_poll_secs(),
            terminal_font_family: None,
            terminal_palette: None,
            terminal_foreground: None,
            terminal_background: None,
            tab_position: default_tab_position(),
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
fn default_tab_position() -> String {
    "left".to_string()
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
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let result = fs::write(&temporary, text)
        .and_then(|()| fs::rename(&temporary, &path))
        .map_err(|e| format!("save {}: {}", path.display(), e));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[tauri::command]
pub async fn general_get() -> Result<GeneralSettings, String> {
    Ok(load_general())
}

#[tauri::command]
pub async fn general_set(settings: GeneralSettings) -> Result<(), String> {
    save_general(&settings)
}

#[cfg(test)]
mod tests {
    use super::GeneralSettings;

    #[test]
    fn legacy_settings_and_custom_appearance_round_trip() {
        let mut settings: GeneralSettings = toml::from_str(
            "scrollback = 12000\nfont_size = 17\nside_font_size = 12\ngit_poll_secs = 9\n",
        )
        .unwrap();
        assert_eq!(settings.terminal_font_family, None);
        assert_eq!(settings.terminal_palette, None);
        assert_eq!(settings.terminal_foreground, None);
        assert_eq!(settings.terminal_background, None);

        settings.terminal_font_family = Some("Sarasa Mono TC".into());
        settings.terminal_palette = Some("custom".into());
        settings.terminal_foreground = Some("#feedbe".into());
        settings.terminal_background = Some("#102030".into());
        let decoded: GeneralSettings =
            toml::from_str(&toml::to_string(&settings).unwrap()).unwrap();

        assert_eq!(decoded.scrollback, 12000);
        assert_eq!(decoded.font_size, 17);
        assert_eq!(decoded.side_font_size, 12);
        assert_eq!(decoded.git_poll_secs, 9);
        assert_eq!(decoded.terminal_font_family, settings.terminal_font_family);
        assert_eq!(decoded.terminal_palette, settings.terminal_palette);
        assert_eq!(decoded.terminal_foreground, settings.terminal_foreground);
        assert_eq!(decoded.terminal_background, settings.terminal_background);
    }
}
