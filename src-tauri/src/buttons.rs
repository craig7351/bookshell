use crate::config::config_dir;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

static BUTTONS_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn lock_buttons_for_write() -> Result<MutexGuard<'static, ()>, String> {
    BUTTONS_WRITE_LOCK.lock().map_err(|error| error.to_string())
}

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
    let temporary = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let result = fs::write(&temporary, text)
        .and_then(|()| fs::rename(&temporary, &path))
        .map_err(|error| format!("save {}: {error}", path.display()));
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
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
    let _guard = lock_buttons_for_write()?;
    let mut all = load_buttons()?;
    if let Some(existing) = all.iter_mut().find(|b| b.id == button.id) {
        *existing = button;
    } else {
        all.push(button);
    }
    save_buttons(&all)
}

#[derive(Deserialize)]
pub struct ImportedCommandButton {
    label: String,
    command: String,
    send_enter: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct ButtonsImportResult {
    added: usize,
    duplicates: usize,
}

fn append_imported_buttons(
    existing: &mut Vec<CommandButton>,
    imported: &[ImportedCommandButton],
) -> Result<ButtonsImportResult, String> {
    if imported
        .iter()
        .any(|button| button.label.trim().is_empty() || button.command.trim().is_empty())
    {
        return Err("Each imported button needs a name and a command.".into());
    }

    let mut known: HashSet<_> = existing
        .iter()
        .map(|button| {
            (
                button.label.as_str(),
                button.command.as_str(),
                button.send_enter,
            )
        })
        .collect();
    let additions: Vec<_> = imported
        .iter()
        .filter(|button| {
            known.insert((
                button.label.as_str(),
                button.command.as_str(),
                button.send_enter,
            ))
        })
        .map(|button| CommandButton {
            id: format!("btn-{}", Uuid::new_v4()),
            label: button.label.clone(),
            command: button.command.clone(),
            send_enter: button.send_enter,
            confirm: false,
            confirm_text: None,
            hotkey: None,
            color: None,
            icon: None,
        })
        .collect();
    let added = additions.len();
    existing.extend(additions);
    Ok(ButtonsImportResult {
        added,
        duplicates: imported.len() - added,
    })
}

#[tauri::command]
pub async fn buttons_import(
    buttons: Vec<ImportedCommandButton>,
) -> Result<ButtonsImportResult, String> {
    let _guard = lock_buttons_for_write()?;
    let mut all = load_buttons()?;
    let result = append_imported_buttons(&mut all, &buttons)?;
    if result.added > 0 {
        save_buttons(&all)?;
    }
    Ok(result)
}

#[tauri::command]
pub async fn buttons_delete(id: String) -> Result<(), String> {
    let _guard = lock_buttons_for_write()?;
    let mut all = load_buttons()?;
    all.retain(|b| b.id != id);
    save_buttons(&all)
}

#[tauri::command]
pub async fn buttons_reorder(ids: Vec<String>) -> Result<(), String> {
    let _guard = lock_buttons_for_write()?;
    let mut all = load_buttons()?;
    all.sort_by_key(|b| ids.iter().position(|id| id == &b.id).unwrap_or(usize::MAX));
    save_buttons(&all)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn button(label: &str, command: &str, send_enter: bool) -> ImportedCommandButton {
        ImportedCommandButton {
            label: label.into(),
            command: command.into(),
            send_enter,
        }
    }

    #[test]
    fn import_appends_in_order_and_skips_exact_duplicates() {
        let mut existing = default_buttons();
        let input = [
            button("git status", "git status", true),
            button("git status", "git status", false),
            button("Test", r"echo a=b\c ", true),
            button("Test", r"echo a=b\c ", true),
        ];
        assert_eq!(
            append_imported_buttons(&mut existing, &input).unwrap(),
            ButtonsImportResult {
                added: 2,
                duplicates: 2
            }
        );
        assert_eq!(existing[2].id, "default-git-status");
        assert!(!existing[3].send_enter);
        assert_eq!(existing[4].command, r"echo a=b\c ");
        assert_eq!(
            append_imported_buttons(&mut existing, &input).unwrap(),
            ButtonsImportResult {
                added: 0,
                duplicates: 4
            }
        );
    }

    #[test]
    fn invalid_import_does_not_append_partial_results() {
        let mut existing = default_buttons();
        assert!(append_imported_buttons(
            &mut existing,
            &[button("Test", "value", true), button(" ", "value", true)]
        )
        .is_err());
        assert_eq!(existing.len(), 3);
    }
}
