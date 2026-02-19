use crate::DaemonState;
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Serialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
}

/// Returns daemon connection info from managed state.
/// Returns Err("Daemon not ready") if the embedded daemon hasn't started yet.
#[tauri::command]
pub async fn get_daemon_info(
    state: tauri::State<'_, Mutex<DaemonState>>,
) -> Result<DaemonInfo, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    match &lock.info {
        Some(info) => Ok(info.clone()),
        None => Err("Daemon not ready".into()),
    }
}
