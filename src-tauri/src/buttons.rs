use crate::config::config_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandButton {
    pub id: String,
    pub label: String,
    pub command: String,
    #[serde(default = "default_true")]
    pub send_enter: bool,
    #[serde(default)]
    pub confirm: bool,
    #[serde(default)]
    pub confirm_text: Option<String>,
    #[serde(default)]
    pub hotkey: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ButtonsFile {
    #[serde(default)]
    pub buttons: Vec<CommandButton>,
}

pub fn buttons_path() -> PathBuf {
    config_dir().join("buttons.toml")
}

pub fn load_buttons() -> Result<Vec<CommandButton>, String> {
    let path = buttons_path();
    if !path.exists() {
        return Ok(default_buttons());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    let file: ButtonsFile =
        toml::from_str(&text).map_err(|e| format!("parse {}: {}", path.display(), e))?;
    Ok(file.buttons)
}

pub fn save_buttons(buttons: &[CommandButton]) -> Result<(), String> {
    let path = buttons_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let file = ButtonsFile {
        buttons: buttons.to_vec(),
    };
    let text = toml::to_string_pretty(&file).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

fn default_buttons() -> Vec<CommandButton> {
    vec![
        CommandButton {
            id: "default-claude".into(),
            label: "🤖 claude".into(),
            command: "claude".into(),
            send_enter: true,
            confirm: false,
            confirm_text: None,
            hotkey: None,
            color: Some("#cba6f7".into()),
            icon: None,
        },
        CommandButton {
            id: "default-clear".into(),
            label: "clear".into(),
            command: "clear".into(),
            send_enter: true,
            confirm: false,
            confirm_text: None,
            hotkey: None,
            color: None,
            icon: None,
        },
        CommandButton {
            id: "default-git-status".into(),
            label: "git status".into(),
            command: "git status".into(),
            send_enter: true,
            confirm: false,
            confirm_text: None,
            hotkey: None,
            color: None,
            icon: None,
        },
    ]
}

#[tauri::command]
pub async fn buttons_list() -> Result<Vec<CommandButton>, String> {
    load_buttons()
}

#[tauri::command]
pub async fn buttons_save(button: CommandButton) -> Result<(), String> {
    let mut all = load_buttons()?;
    if let Some(existing) = all.iter_mut().find(|b| b.id == button.id) {
        *existing = button;
    } else {
        all.push(button);
    }
    save_buttons(&all)
}

#[tauri::command]
pub async fn buttons_delete(id: String) -> Result<(), String> {
    let mut all = load_buttons()?;
    all.retain(|b| b.id != id);
    save_buttons(&all)
}

#[tauri::command]
pub async fn buttons_reorder(ids: Vec<String>) -> Result<(), String> {
    let mut all = load_buttons()?;
    all.sort_by_key(|b| ids.iter().position(|id| id == &b.id).unwrap_or(usize::MAX));
    save_buttons(&all)
}
