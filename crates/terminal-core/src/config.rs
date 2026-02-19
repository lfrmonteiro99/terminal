use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    /// Address to bind to (default: 127.0.0.1)
    pub host: String,
    /// Port (0 = random)
    pub port: u16,
    /// Heartbeat interval in seconds
    pub heartbeat_interval_secs: u64,
    /// Heartbeat timeout in seconds (missed pongs)
    pub heartbeat_timeout_secs: u64,
    /// Grace window for orphan runs in WaitingInput (seconds)
    pub orphan_grace_secs: u64,
    /// Default run timeout in seconds
    pub run_timeout_secs: u64,
    /// Directory for daemon data (~/.terminal-daemon/)
    pub data_dir: PathBuf,
    /// Path to claude CLI binary
    pub claude_binary: String,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            host: "127.0.0.1".into(),
            port: 0,
            heartbeat_interval_secs: 30,
            heartbeat_timeout_secs: 60,
            orphan_grace_secs: 60,
            run_timeout_secs: 600,
            data_dir: home.join(".terminal-daemon"),
            claude_binary: "claude".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_values() {
        let config = DaemonConfig::default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 0);
        assert_eq!(config.heartbeat_interval_secs, 30);
        assert_eq!(config.run_timeout_secs, 600);
        assert_eq!(config.claude_binary, "claude");
    }

    #[test]
    fn config_serialization_roundtrip() {
        let config = DaemonConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: DaemonConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.host, config.host);
        assert_eq!(deserialized.port, config.port);
    }
}
