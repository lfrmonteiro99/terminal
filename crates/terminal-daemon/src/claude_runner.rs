//! Spawns the Claude Code CLI in stream-json mode and translates its output
//! into `RunnerEvent`s for the supervisor.
//!
//! Key decisions:
//! - Invoke `claude -p <prompt> --output-format stream-json --verbose`. Print
//!   mode is required for a headless subprocess; stream-json + verbose gives
//!   us structured tool-use / result events instead of plain text.
//! - Permission mode defaults to `bypassPermissions` (via
//!   `--dangerously-skip-permissions`) because runs execute inside an isolated
//!   git worktree — nothing outside the worktree is at risk. This avoids the
//!   previous "Claude asks for permission, no TTY to approve, exits after 1s"
//!   failure mode. `RunMode::Strict` falls back to `default` permission mode
//!   so the operator stays in control.
//! - Pre-flight checks: confirm `claude --version` succeeds before attempting
//!   to run a prompt. A missing or broken binary surfaces as a structured
//!   `Preflight` event instead of a cryptic spawn error.

use crate::parser::{ParseEvent, StreamParser};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use terminal_core::config::DaemonConfig;
use terminal_core::models::RunMode;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{debug, error, info};
use uuid::Uuid;

/// Events emitted by the Claude runner to the supervisor.
#[derive(Debug)]
#[allow(dead_code)]
pub enum RunnerEvent {
    /// Plain-text line destined for the output log / UI stream.
    StdoutLine(String),
    /// Stderr line (already tagged by the runner).
    StderrLine(String),
    /// Assistant message text block.
    AssistantText(String),
    /// Claude called a tool.
    ToolUse {
        id: String,
        name: String,
        input_preview: String,
    },
    /// A tool returned a result.
    ToolResult {
        tool_use_id: String,
        is_error: bool,
        preview: String,
    },
    /// Session init (model + session id from stream-json header).
    SessionInit {
        model: Option<String>,
        session_id: Option<String>,
    },
    /// Final metrics from the result event.
    Metrics {
        num_turns: u32,
        cost_usd: f64,
        input_tokens: u64,
        output_tokens: u64,
    },
    /// Pre-spawn failure: binary missing, unauthenticated, etc. Surfaced
    /// separately from `SpawnError` so the UI can show an actionable message.
    Preflight { reason: String, suggestion: String },
    /// Process exited.
    ProcessExited { exit_code: Option<i32> },
    /// Error spawning the child process.
    SpawnError(String),
}

/// What to pass to `claude --permission-mode`. Mirrors Claude Code's CLI.
#[derive(Debug, Clone, Copy)]
enum PermissionMode {
    BypassAll,
    AcceptEdits,
    Default,
}

impl PermissionMode {
    fn cli_value(self) -> &'static str {
        match self {
            PermissionMode::BypassAll => "bypassPermissions",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Default => "default",
        }
    }
}

/// Map `RunMode` to a permission strategy. Runs execute in an isolated
/// worktree, so `Free` bypassing permissions is safe by construction.
fn permission_mode_for(mode: &RunMode) -> PermissionMode {
    match mode {
        RunMode::Free => PermissionMode::BypassAll,
        RunMode::Guided => PermissionMode::AcceptEdits,
        RunMode::Strict => PermissionMode::Default,
    }
}

pub struct ClaudeRunner {
    config: DaemonConfig,
}

impl ClaudeRunner {
    pub fn new(config: DaemonConfig) -> Self {
        Self { config }
    }

    /// Check that the Claude binary exists and is runnable. Returns `Ok(())`
    /// if `claude --version` exits 0; otherwise a human-friendly error + fix.
    pub async fn preflight(&self) -> Result<PreflightInfo, PreflightFailure> {
        let binary = &self.config.claude_binary;

        let result = Command::new(binary)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match result {
            Ok(out) if out.status.success() => {
                let version =
                    String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(PreflightInfo { version })
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Err(PreflightFailure {
                    reason: format!(
                        "`{} --version` exited with {}: {}",
                        binary,
                        out.status.code().unwrap_or(-1),
                        if stderr.is_empty() { "no output".into() } else { stderr }
                    ),
                    suggestion: "verify Claude Code is installed and authenticated: `claude doctor`".into(),
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(PreflightFailure {
                reason: format!("`{}` binary not found on PATH", binary),
                suggestion:
                    "install Claude Code: https://docs.claude.com/en/docs/claude-code/overview — \
                     or set `claude_binary` / TERMINAL_CLAUDE_BINARY to the full path."
                        .into(),
            }),
            Err(e) => Err(PreflightFailure {
                reason: format!("failed to run `{} --version`: {}", binary, e),
                suggestion: "check that the configured claude binary is executable".into(),
            }),
        }
    }

    /// Spawn `claude -p` with stream-json output. Returns the event stream,
    /// a stdin sender (reserved for future interactive modes), and the child.
    ///
    /// The caller must have already run `preflight()` or be prepared to
    /// translate `SpawnError` into a UI-visible failure.
    pub fn spawn(
        &self,
        run_id: Uuid,
        prompt: &str,
        mode: &RunMode,
        working_dir: &Path,
    ) -> Result<(mpsc::Receiver<RunnerEvent>, mpsc::Sender<String>, Child), String> {
        // Reject empty / whitespace-only prompts before we touch the CLI.
        // Preserved from the safety hardening pass in #61.
        if prompt.trim().is_empty() {
            return Err("Cannot start run with empty prompt".into());
        }

        let perm = permission_mode_for(mode);

        // Headless JSONL stream. `--verbose` is required alongside
        // `--output-format stream-json` for Claude to emit every event.
        let mut cmd = Command::new(&self.config.claude_binary);
        cmd.arg("-p")
            .arg(prompt)
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--permission-mode")
            .arg(perm.cli_value());

        // For Free mode, also pass the explicit bypass flag. Some Claude Code
        // versions require it in addition to `--permission-mode
        // bypassPermissions` to actually engage.
        if matches!(perm, PermissionMode::BypassAll) {
            cmd.arg("--dangerously-skip-permissions");
        }

        let mut child = cmd
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn `{}`: {}", self.config.claude_binary, e))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        let (event_tx, event_rx) = mpsc::channel::<RunnerEvent>(256);
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(16);

        // Stdout reader — parse stream-json line by line.
        let event_tx_stdout = event_tx.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut parser = StreamParser::new();

            while let Ok(Some(line)) = lines.next_line().await {
                for ev in parser.feed_line(&line) {
                    match ev {
                        ParseEvent::AssistantText(text) => {
                            // Fan text out line-by-line so the UI can stream
                            // it without buffering a whole message.
                            for l in text.split_inclusive('\n') {
                                let _ = event_tx_stdout
                                    .send(RunnerEvent::AssistantText(l.to_string()))
                                    .await;
                            }
                        }
                        ParseEvent::ToolUse { id, name, input_preview } => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::ToolUse { id, name, input_preview })
                                .await;
                        }
                        ParseEvent::ToolResult { tool_use_id, is_error, preview } => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::ToolResult {
                                    tool_use_id,
                                    is_error,
                                    preview,
                                })
                                .await;
                        }
                        ParseEvent::SessionInit { model, session_id } => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::SessionInit { model, session_id })
                                .await;
                        }
                        ParseEvent::Result {
                            success,
                            subtype,
                            num_turns,
                            cost_usd,
                            input_tokens,
                            output_tokens,
                            error_text,
                        } => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::Metrics {
                                    num_turns,
                                    cost_usd,
                                    input_tokens,
                                    output_tokens,
                                })
                                .await;
                            if !success {
                                let reason = error_text
                                    .unwrap_or_else(|| format!("claude result: {subtype}"));
                                let _ = event_tx_stdout
                                    .send(RunnerEvent::StderrLine(reason))
                                    .await;
                            }
                        }
                        ParseEvent::RawLine(l) => {
                            // Preserve non-JSON lines (e.g. Claude auth
                            // messages before streaming starts) so users
                            // see them instead of silently dropping.
                            debug!("claude raw line: {}", l);
                            let _ = event_tx_stdout.send(RunnerEvent::StdoutLine(l)).await;
                        }
                    }
                }
            }
        });

        // Stderr reader.
        let event_tx_stderr = event_tx.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = event_tx_stderr.send(RunnerEvent::StderrLine(line)).await;
            }
        });

        // Stdin writer — unused for now in stream-json mode (Claude doesn't
        // wait for stdin when run headless) but kept wired so future
        // interactive modes can reuse the channel.
        let mut stdin_handle = child.stdin.take();
        tokio::spawn(async move {
            if let Some(ref mut stdin) = stdin_handle {
                while let Some(response) = stdin_rx.recv().await {
                    if let Err(e) = stdin.write_all(response.as_bytes()).await {
                        error!("failed to write to claude stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin.write_all(b"\n").await {
                        error!("failed to write newline to claude stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin.flush().await {
                        error!("failed to flush claude stdin: {}", e);
                        break;
                    }
                }
            }
        });

        info!("claude stream-json process spawned for run {}", run_id);
        Ok((event_rx, stdin_tx, child))
    }
}

/// Successful preflight result.
#[derive(Debug, Clone)]
pub struct PreflightInfo {
    #[allow(dead_code)]
    pub version: String,
}

/// Structured preflight failure ready for UI display.
#[derive(Debug, Clone)]
pub struct PreflightFailure {
    pub reason: String,
    pub suggestion: String,
}

/// Get the output file path for a given run.
pub fn output_file_path(data_dir: &Path, run_id: &Uuid) -> PathBuf {
    data_dir.join("runs").join(run_id.to_string()).join("output.jsonl")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn permission_mode_mapping_covers_all_run_modes() {
        assert!(matches!(permission_mode_for(&RunMode::Free), PermissionMode::BypassAll));
        assert!(matches!(permission_mode_for(&RunMode::Guided), PermissionMode::AcceptEdits));
        assert!(matches!(permission_mode_for(&RunMode::Strict), PermissionMode::Default));
    }

    #[test]
    fn permission_mode_cli_values_match_claude_cli() {
        assert_eq!(PermissionMode::BypassAll.cli_value(), "bypassPermissions");
        assert_eq!(PermissionMode::AcceptEdits.cli_value(), "acceptEdits");
        assert_eq!(PermissionMode::Default.cli_value(), "default");
    }

    #[tokio::test]
    async fn preflight_reports_missing_binary() {
        let mut cfg = DaemonConfig::default();
        cfg.claude_binary = "definitely_not_a_real_binary_xyz_123".into();
        let runner = ClaudeRunner::new(cfg);
        let err = runner.preflight().await.unwrap_err();
        assert!(err.reason.contains("not found"));
        assert!(err.suggestion.to_lowercase().contains("install"));
    }

    #[test]
    fn empty_prompt_rejected() {
        let mut cfg = DaemonConfig::default();
        cfg.claude_binary = "echo".into();
        let runner = ClaudeRunner::new(cfg);
        let err = runner
            .spawn(Uuid::new_v4(), "", &RunMode::Free, Path::new("/tmp"))
            .unwrap_err();
        assert!(err.to_lowercase().contains("empty"));
    }

    #[test]
    fn whitespace_only_prompt_rejected() {
        let mut cfg = DaemonConfig::default();
        cfg.claude_binary = "echo".into();
        let runner = ClaudeRunner::new(cfg);
        let err = runner
            .spawn(Uuid::new_v4(), "   \n\t  ", &RunMode::Free, Path::new("/tmp"))
            .unwrap_err();
        assert!(err.to_lowercase().contains("empty"));
    }
}
