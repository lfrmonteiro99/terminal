use serde::Serialize;

#[derive(Serialize)]
pub struct DaemonInfo {
    pub port: u16,
    pub token: String,
}

/// Read daemon connection info from ~/.terminal-daemon/
#[tauri::command]
pub async fn get_daemon_info() -> Result<DaemonInfo, String> {
    let home = dirs_next::home_dir().ok_or("Cannot find home directory")?;
    let data_dir = home.join(".terminal-daemon");

    let port_str = tokio::fs::read_to_string(data_dir.join("port"))
        .await
        .map_err(|e| format!("Failed to read port file: {}. Is the daemon running?", e))?;

    let port: u16 = port_str
        .trim()
        .parse()
        .map_err(|e| format!("Invalid port: {}", e))?;

    let token = tokio::fs::read_to_string(data_dir.join("auth_token"))
        .await
        .map_err(|e| format!("Failed to read auth token: {}", e))?;

    Ok(DaemonInfo {
        port,
        token: token.trim().to_string(),
    })
}
