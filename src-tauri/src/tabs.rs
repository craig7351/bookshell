use crate::config::config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabState {
    pub id: String,
    pub name: String,
    pub connection_id: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub passthrough: bool,
    /// Manually marked working directory; `cd` is sent after reconnect.
    #[serde(default)]
    pub cwd: Option<String>,
    /// Per-tab width (px) of the right-side Git panel. Persisted so each tab
    /// remembers the user's preferred width across sessions.
    #[serde(default)]
    pub git_width: Option<u32>,
    /// Id of the group this tab belongs to, if any. Groups are defined in
    /// `TabsFile::groups`; a tab with no `group_id` is ungrouped.
    #[serde(default)]
    pub group_id: Option<String>,
}

/// A collapsible category the user drags tabs into.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TabGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TabsFile {
    #[serde(default)]
    pub tabs: Vec<TabState>,
    #[serde(default)]
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub groups: Vec<TabGroup>,
}

pub fn tabs_path() -> PathBuf {
    config_dir().join("tabs.toml")
}

#[tauri::command]
pub async fn tabs_load_state() -> Result<TabsFile, String> {
    let path = tabs_path();
    if !path.exists() {
        return Ok(TabsFile::default());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    toml::from_str(&text).map_err(|e| format!("parse {}: {}", path.display(), e))
}

#[tauri::command]
pub async fn tabs_save_state(state: TabsFile) -> Result<(), String> {
    let path = tabs_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let text = toml::to_string_pretty(&state).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}
