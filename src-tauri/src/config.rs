use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    // Phase 1G: Key, Agent
}

impl Default for AuthMethod {
    fn default() -> Self {
        AuthMethod::Password
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionKind {
    #[default]
    Ssh,
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Connection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: ConnectionKind,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub auth: AuthMethod,
    /// Phase 1A: stored as plaintext. TODO Phase 1G: DPAPI-encrypt.
    #[serde(default)]
    pub password: Option<String>,
    /// Local kind only — shell command (e.g. "powershell.exe", "/bin/bash").
    /// `None` falls back to platform default.
    #[serde(default)]
    pub shell: Option<String>,
    /// Local kind only — initial working directory.
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
}

fn default_port() -> u16 {
    22
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConnectionsFile {
    #[serde(default)]
    pub connections: Vec<Connection>,
}

pub fn config_dir() -> PathBuf {
    if let Some(dirs) = directories::ProjectDirs::from("dev", "bookshell", "BOOKSHELL") {
        return dirs.config_dir().to_path_buf();
    }
    // Fallback: cwd
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

pub fn connections_path() -> PathBuf {
    config_dir().join("connections.toml")
}

pub fn load_connections() -> Result<Vec<Connection>, String> {
    let path = connections_path();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(&path).map_err(|e| format!("read {}: {}", path.display(), e))?;
    let file: ConnectionsFile =
        toml::from_str(&text).map_err(|e| format!("parse {}: {}", path.display(), e))?;
    Ok(file.connections)
}

pub fn save_connections(connections: &[Connection]) -> Result<(), String> {
    let path = connections_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir {}: {}", parent.display(), e))?;
    }
    let file = ConnectionsFile {
        connections: connections.to_vec(),
    };
    let text = toml::to_string_pretty(&file).map_err(|e| format!("serialize: {}", e))?;
    fs::write(&path, text).map_err(|e| format!("write {}: {}", path.display(), e))?;
    Ok(())
}

#[tauri::command]
pub async fn config_list_connections() -> Result<Vec<Connection>, String> {
    load_connections()
}

#[tauri::command]
pub async fn config_save_connection(connection: Connection) -> Result<(), String> {
    let mut all = load_connections()?;
    if let Some(existing) = all.iter_mut().find(|c| c.id == connection.id) {
        *existing = connection;
    } else {
        all.push(connection);
    }
    save_connections(&all)
}

#[tauri::command]
pub async fn config_delete_connection(id: String) -> Result<(), String> {
    let mut all = load_connections()?;
    all.retain(|c| c.id != id);
    save_connections(&all)
}

#[tauri::command]
pub async fn config_reorder_connections(ids: Vec<String>) -> Result<(), String> {
    let mut all = load_connections()?;
    all.sort_by_key(|c| ids.iter().position(|id| id == &c.id).unwrap_or(usize::MAX));
    save_connections(&all)
}
