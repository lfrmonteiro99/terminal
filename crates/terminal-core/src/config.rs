use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub enum DaemonMode {
    #[default]
    Standalone,
    Embedded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaemonConfig {
    /// Daemon mode: Standalone writes port/token to disk, Embedded keeps in memory only
    pub mode: DaemonMode,
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
    /// Optional Claude MCP config file forwarded with --mcp-config
    pub mcp_config_path: Option<PathBuf>,
    /// Optional global Claude tool allowlist forwarded with --allowed-tools
    pub allowed_tools: Option<Vec<String>>,
    /// Optional global Claude tool denylist forwarded with --disallowed-tools
    pub disallowed_tools: Option<Vec<String>>,
}

impl Default for DaemonConfig {
    fn default() -> Self {
        let home = dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."));
        Self {
            mode: DaemonMode::Standalone,
            host: std::env::var("TERMINAL_HOST").unwrap_or_else(|_| "127.0.0.1".into()),
            port: std::env::var("TERMINAL_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(0),
            heartbeat_interval_secs: 30,
            heartbeat_timeout_secs: std::env::var("TERMINAL_HEARTBEAT_TIMEOUT_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(90),
            orphan_grace_secs: 60,
            run_timeout_secs: 600,
            data_dir: std::env::var("TERMINAL_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|_| home.join(".terminal-daemon")),
            claude_binary: std::env::var("TERMINAL_CLAUDE_BINARY")
                .unwrap_or_else(|_| "claude".into()),
            mcp_config_path: std::env::var("TERMINAL_MCP_CONFIG").ok().map(PathBuf::from),
            allowed_tools: parse_csv_env("TERMINAL_ALLOWED_TOOLS"),
            disallowed_tools: parse_csv_env("TERMINAL_DISALLOWED_TOOLS"),
        }
    }
}

fn parse_csv_env(name: &str) -> Option<Vec<String>> {
    std::env::var(name).ok().and_then(|value| {
        let items: Vec<String> = value
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        if items.is_empty() {
            None
        } else {
            Some(items)
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static CONFIG_ENV_LOCK: Mutex<()> = Mutex::new(());
    const CONFIG_ENV_KEYS: &[&str] = &[
        "TERMINAL_HOST",
        "TERMINAL_PORT",
        "TERMINAL_HEARTBEAT_TIMEOUT_SECS",
        "TERMINAL_DATA_DIR",
        "TERMINAL_CLAUDE_BINARY",
        "TERMINAL_MCP_CONFIG",
        "TERMINAL_ALLOWED_TOOLS",
        "TERMINAL_DISALLOWED_TOOLS",
    ];

    struct EnvSnapshot(Vec<(String, Option<String>)>);

    impl EnvSnapshot {
        fn clear_terminal_env() -> Self {
            let snapshot = CONFIG_ENV_KEYS
                .iter()
                .map(|&key| (key.to_string(), std::env::var(key).ok()))
                .collect();
            for key in CONFIG_ENV_KEYS {
                std::env::remove_var(key);
            }
            Self(snapshot)
        }
    }

    impl Drop for EnvSnapshot {
        fn drop(&mut self) {
            for (key, value) in &self.0 {
                match value {
                    Some(value) => std::env::set_var(key, value),
                    None => std::env::remove_var(key),
                }
            }
        }
    }

    #[test]
    fn default_config_values() {
        let _guard = CONFIG_ENV_LOCK.lock().unwrap();
        let _env = EnvSnapshot::clear_terminal_env();
        let config = DaemonConfig::default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 0);
        assert_eq!(config.heartbeat_interval_secs, 30);
        assert_eq!(config.heartbeat_timeout_secs, 90);
        assert_eq!(config.run_timeout_secs, 600);
        assert_eq!(config.claude_binary, "claude");
    }

    #[test]
    fn heartbeat_timeout_can_be_configured_from_env() {
        let _guard = CONFIG_ENV_LOCK.lock().unwrap();
        let _env = EnvSnapshot::clear_terminal_env();
        std::env::set_var("TERMINAL_HEARTBEAT_TIMEOUT_SECS", "7");
        let config = DaemonConfig::default();
        std::env::remove_var("TERMINAL_HEARTBEAT_TIMEOUT_SECS");

        assert_eq!(config.heartbeat_timeout_secs, 7);
    }

    #[test]
    fn mcp_config_path_can_be_configured_from_env() {
        let _guard = CONFIG_ENV_LOCK.lock().unwrap();
        let _env = EnvSnapshot::clear_terminal_env();
        std::env::set_var("TERMINAL_MCP_CONFIG", "/tmp/mcp.json");
        let config = DaemonConfig::default();
        std::env::remove_var("TERMINAL_MCP_CONFIG");

        assert_eq!(config.mcp_config_path, Some(PathBuf::from("/tmp/mcp.json")));
    }

    #[test]
    fn config_serialization_roundtrip() {
        let _guard = CONFIG_ENV_LOCK.lock().unwrap();
        let _env = EnvSnapshot::clear_terminal_env();
        let config = DaemonConfig::default();
        let json = serde_json::to_string_pretty(&config).unwrap();
        let deserialized: DaemonConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.host, config.host);
        assert_eq!(deserialized.port, config.port);
    }
}
