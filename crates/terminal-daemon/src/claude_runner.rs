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
use terminal_core::models::{Agent, AutonomyLevel, RunMode, Runner};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command};
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};
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
    /// Claude invoked the ExitPlanMode tool with a plan ready for approval.
    ExitPlanMode { tool_use_id: String, plan: String },
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
    /// The stream-json `result` event was observed (signals a proper exit).
    ResultSeen,
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
    /// `--permission-mode bypassPermissions` + `--dangerously-skip-permissions`.
    /// Claude executes every tool without prompting. Safe inside a worktree.
    BypassAll,
    /// `--permission-mode acceptEdits`. Auto-approves Edit/Write; prompts for
    /// Bash. Currently unused in the UI path (kept for potential Guided mode).
    AcceptEdits,
    /// `--permission-mode plan`. Claude writes a plan without executing any
    /// edits/bash. Powers the "ReviewPlan" autonomy level.
    Plan,
    /// `--permission-mode default`. Prompts for every tool. Not usable
    /// headless; reserved for future interactive modes.
    Default,
}

impl PermissionMode {
    fn cli_value(self) -> &'static str {
        match self {
            PermissionMode::BypassAll => "bypassPermissions",
            PermissionMode::AcceptEdits => "acceptEdits",
            PermissionMode::Plan => "plan",
            PermissionMode::Default => "default",
        }
    }
}

/// Translate the user-facing `AutonomyLevel` (paired with the legacy
/// `RunMode` for edge cases) into the exact permission flags we pass to the
/// Claude Code CLI. Autonomy takes priority; RunMode is only consulted when
/// autonomy is `Autonomous` and the caller picked a non-default RunMode.
fn permission_mode_for(mode: &RunMode, autonomy: AutonomyLevel) -> PermissionMode {
    match autonomy {
        AutonomyLevel::ReviewPlan => PermissionMode::Plan,
        AutonomyLevel::Autonomous => match mode {
            RunMode::Free => PermissionMode::BypassAll,
            RunMode::Guided => PermissionMode::AcceptEdits,
            // Strict + Autonomous shouldn't happen via the new UI, but if a
            // legacy client sends it, fall back to the default permission
            // mode rather than silently escalating privileges.
            RunMode::Strict => PermissionMode::Default,
        },
    }
}

fn claude_args_for(
    prompt: &str,
    mode: &RunMode,
    autonomy: AutonomyLevel,
    config: &DaemonConfig,
    chat: bool,
    agent: Option<&Agent>,
) -> Vec<String> {
    let perm = permission_mode_for(mode, autonomy);
    let mut args = vec![
        "-p".to_string(),
        prompt.to_string(),
        "--output-format".to_string(),
        "stream-json".to_string(),
    ];

    if chat {
        args.push("--input-format".to_string());
        args.push("stream-json".to_string());
    }

    args.extend([
        "--verbose".to_string(),
        "--permission-mode".to_string(),
        perm.cli_value().to_string(),
    ]);

    if matches!(perm, PermissionMode::BypassAll) {
        args.push("--dangerously-skip-permissions".to_string());
    }

    append_config_args(&mut args, config);
    append_agent_args(&mut args, agent);

    args
}

/// Fold a driving agent into the CLI invocation: its model pin becomes
/// `--model` and its mission becomes `--append-system-prompt`. Both are
/// optional; an agentless run adds nothing.
fn append_agent_args(args: &mut Vec<String>, agent: Option<&Agent>) {
    let Some(agent) = agent else { return };

    if let Some(model) = agent.model.as_ref().filter(|m| !m.trim().is_empty()) {
        args.push("--model".to_string());
        args.push(model.clone());
    }

    if !agent.instructions.trim().is_empty() {
        args.push("--append-system-prompt".to_string());
        args.push(agent.instructions.clone());
    }
}

/// Fold a driving agent into a `hermes -z` invocation.
///
/// `hermes -z` prints ONLY the final response text to stdout (no banner, no
/// spinner, no stream-json), so the supervisor sees a coarser run than with
/// Claude: no tool-use events and no token metrics. What it does not have is an
/// `--append-system-prompt`, so the agent's composed instructions are prepended
/// to the prompt as an explicit preamble — the only lever hermes exposes.
fn hermes_args_for(prompt: &str, agent: Option<&Agent>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(model) = agent
        .and_then(|a| a.model.as_ref())
        .filter(|m| !m.trim().is_empty())
    {
        args.push("-m".to_string());
        args.push(model.clone());
    }
    args.push("-z".to_string());
    args.push(match agent {
        Some(a) if !a.instructions.trim().is_empty() => {
            format!("{}\n\n---\n\n{}", a.instructions.trim(), prompt)
        }
        _ => prompt.to_string(),
    });
    args
}

/// Read a hermes one-shot's plain-text stdout into the shared `RunnerEvent`
/// channel. `-z` prints the final text only, so every line is assistant output;
/// `ResultSeen` is emitted on EOF, which is what tells the supervisor the run
/// finished rather than dying mid-stream.
fn spawn_hermes_readers(
    run_id: Uuid,
    stdout: ChildStdout,
    stderr: ChildStderr,
    event_tx: mpsc::Sender<RunnerEvent>,
) {
    let event_tx_stdout = event_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = event_tx_stdout.send(RunnerEvent::StdoutLine(line)).await;
                }
                Ok(None) => break,
                Err(e) => {
                    error!("hermes stdout read error: {e}");
                    break;
                }
            }
        }
        // hermes exited cleanly (child.wait handles the code); signal a proper
        // completion so the supervisor does not report "stream ended without
        // result event".
        let _ = event_tx_stdout.send(RunnerEvent::ResultSeen).await;
        debug!("hermes stdout reader finished for run {run_id}");
    });

    let event_tx_stderr = event_tx;
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = event_tx_stderr.send(RunnerEvent::StderrLine(line)).await;
        }
    });
}

fn append_config_args(args: &mut Vec<String>, config: &DaemonConfig) {
    if let Some(path) = &config.mcp_config_path {
        args.push("--mcp-config".to_string());
        args.push(path.to_string_lossy().into_owned());
    }

    if let Some(tools) = &config.allowed_tools {
        if !tools.is_empty() {
            args.push("--allowed-tools".to_string());
            args.push(tools.join(","));
        }
    }

    if let Some(tools) = &config.disallowed_tools {
        if !tools.is_empty() {
            args.push("--disallowed-tools".to_string());
            args.push(tools.join(","));
        }
    }
}

fn chat_user_message_line(text: &str) -> String {
    let msg = serde_json::json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": [{ "type": "text", "text": text }]
        }
    });
    format!("{msg}\n")
}

fn spawn_chat_stdin_writer(mut stdin: ChildStdin) -> mpsc::Sender<String> {
    let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(16);
    tokio::spawn(async move {
        while let Some(text) = stdin_rx.recv().await {
            let line = chat_user_message_line(&text);
            if let Err(e) = stdin.write_all(line.as_bytes()).await {
                warn!("chat stdin write failed: {e}");
                break;
            }
            if let Err(e) = stdin.flush().await {
                warn!("chat stdin flush failed: {e}");
                break;
            }
        }
    });
    stdin_tx
}

fn spawn_stream_readers(
    run_id: Uuid,
    stdout: ChildStdout,
    stderr: ChildStderr,
    event_tx: mpsc::Sender<RunnerEvent>,
) {
    let event_tx_stdout = event_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut parser = StreamParser::new();

        loop {
            let line = match lines.next_line().await {
                Ok(Some(line)) => line,
                Ok(None) => break,
                Err(e) => {
                    error!("claude stdout read error: {e}");
                    break;
                }
            };
            for event in parser.feed_line(&line) {
                match event {
                    ParseEvent::AssistantText(text) => {
                        for line in text.split_inclusive(char::from(10)) {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::AssistantText(line.to_string()))
                                .await;
                        }
                    }
                    ParseEvent::ToolUse {
                        id,
                        name,
                        input_preview,
                    } => {
                        let _ = event_tx_stdout
                            .send(RunnerEvent::ToolUse {
                                id,
                                name,
                                input_preview,
                            })
                            .await;
                    }
                    ParseEvent::ExitPlanMode { tool_use_id, plan } => {
                        let _ = event_tx_stdout
                            .send(RunnerEvent::ExitPlanMode { tool_use_id, plan })
                            .await;
                    }
                    ParseEvent::ToolResult {
                        tool_use_id,
                        is_error,
                        preview,
                    } => {
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
                        if success {
                            let _ = event_tx_stdout.send(RunnerEvent::ResultSeen).await;
                        }
                        let _ = event_tx_stdout
                            .send(RunnerEvent::Metrics {
                                num_turns,
                                cost_usd,
                                input_tokens,
                                output_tokens,
                            })
                            .await;
                        if !success {
                            let reason =
                                error_text.unwrap_or_else(|| format!("claude result: {subtype}"));
                            let _ = event_tx_stdout.send(RunnerEvent::StderrLine(reason)).await;
                        }
                    }
                    ParseEvent::RawLine(line) => {
                        debug!("claude raw line: {line}");
                        let _ = event_tx_stdout.send(RunnerEvent::StdoutLine(line)).await;
                    }
                }
            }
        }
        debug!("claude stdout reader finished for run {run_id}");
    });

    let event_tx_stderr = event_tx.clone();
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    let _ = event_tx_stderr.send(RunnerEvent::StderrLine(line)).await;
                }
                Ok(None) => break,
                Err(e) => {
                    error!("claude stderr read error: {e}");
                    break;
                }
            }
        }
        debug!("claude stderr reader finished for run {run_id}");
    });
}

pub struct ClaudeRunner {
    config: DaemonConfig,
}

impl ClaudeRunner {
    pub fn new(config: DaemonConfig) -> Self {
        Self { config }
    }

    /// Check that the binary for `runner` exists and is runnable, returning a
    /// human-friendly reason + fix when it does not. Without this, selecting a
    /// runner whose CLI is missing would surface as an opaque spawn error.
    pub async fn preflight_for(&self, runner: Runner) -> Result<PreflightInfo, PreflightFailure> {
        match runner {
            Runner::Claude => self.preflight_binary(&self.config.claude_binary, "--version", "install Claude Code: https://docs.claude.com/en/docs/claude-code/overview — or set `claude_binary` / TERMINAL_CLAUDE_BINARY to the full path.").await,
            Runner::Hermes => self.preflight_binary(&self.config.hermes_binary, "--version", "install Hermes Agent — or set `hermes_binary` / TERMINAL_HERMES_BINARY to the full path.").await,
        }
    }

    async fn preflight_binary(
        &self,
        binary: &str,
        version_flag: &str,
        install_hint: &str,
    ) -> Result<PreflightInfo, PreflightFailure> {
        let result = Command::new(binary)
            .arg(version_flag)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .await;

        match result {
            Ok(out) if out.status.success() => {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(PreflightInfo { version })
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Err(PreflightFailure {
                    reason: format!(
                        "`{} {}` exited with {}: {}",
                        binary,
                        version_flag,
                        out.status.code().unwrap_or(-1),
                        if stderr.is_empty() {
                            "no output".into()
                        } else {
                            stderr
                        }
                    ),
                    suggestion: format!("`{binary}` is installed but not runnable: {install_hint}"),
                })
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(PreflightFailure {
                reason: format!("`{}` binary not found on PATH", binary),
                suggestion: install_hint.into(),
            }),
            Err(e) => Err(PreflightFailure {
                reason: format!("failed to run `{}`: {}", binary, e),
                suggestion: "check that the configured binary is executable".into(),
            }),
        }
    }

    /// Check that the Claude binary exists and is runnable. Returns `Ok(())`
    /// if `claude --version` exits 0; otherwise a human-friendly error + fix.
    pub async fn preflight(&self) -> Result<PreflightInfo, PreflightFailure> {
        self.preflight_for(Runner::Claude).await
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
        autonomy: AutonomyLevel,
        agent: Option<&Agent>,
        working_dir: &Path,
    ) -> Result<(mpsc::Receiver<RunnerEvent>, Child), String> {
        // Reject empty / whitespace-only prompts before we touch the CLI.
        // Preserved from the safety hardening pass in #61.
        if prompt.trim().is_empty() {
            return Err("Cannot start run with empty prompt".into());
        }

        // Headless JSONL stream. The argument builder is unit-tested so new
        // Claude flags stay visible without spawning the real binary.
        let runner = agent.map(|a| a.runner).unwrap_or_default();
        let (binary, args) = match runner {
            Runner::Claude => (
                self.config.claude_binary.clone(),
                claude_args_for(prompt, mode, autonomy, &self.config, false, agent),
            ),
            Runner::Hermes => (
                self.config.hermes_binary.clone(),
                hermes_args_for(prompt, agent),
            ),
        };

        let mut cmd = Command::new(&binary);
        cmd.args(&args);

        let mut child = cmd
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to spawn `{}`: {}", binary, e))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        let (event_tx, event_rx) = mpsc::channel::<RunnerEvent>(256);
        match runner {
            Runner::Claude => spawn_stream_readers(run_id, stdout, stderr, event_tx),
            Runner::Hermes => spawn_hermes_readers(run_id, stdout, stderr, event_tx),
        }

        info!("{runner:?} runner spawned for run {run_id}");
        Ok((event_rx, child))
    }

    /// Spawn a long-lived chat process and return a sender for JSONL user turns.
    pub fn spawn_chat(
        &self,
        run_id: Uuid,
        prompt: &str,
        mode: &RunMode,
        autonomy: AutonomyLevel,
        working_dir: &Path,
    ) -> Result<(mpsc::Receiver<RunnerEvent>, mpsc::Sender<String>, Child), String> {
        if prompt.trim().is_empty() {
            return Err("Cannot start chat with empty prompt".into());
        }

        let mut cmd = Command::new(&self.config.claude_binary);
        cmd.args(claude_args_for(prompt, mode, autonomy, &self.config, true, None));

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
        let stdin = child.stdin.take().ok_or("no stdin")?;

        let (event_tx, event_rx) = mpsc::channel::<RunnerEvent>(256);
        let stdin_tx = spawn_chat_stdin_writer(stdin);
        spawn_stream_readers(run_id, stdout, stderr, event_tx);

        info!("claude chat process spawned for run {run_id}");
        Ok((event_rx, stdin_tx, child))
    }

    /// Respawn a chat after plan approval, preserving Claude conversation context.
    pub fn respawn_with_resume(
        &self,
        run_id: Uuid,
        claude_session_id: &str,
        working_dir: &Path,
    ) -> Result<(mpsc::Receiver<RunnerEvent>, mpsc::Sender<String>, Child), String> {
        let mut args = vec![
            "--resume".to_string(),
            claude_session_id.to_string(),
            "--output-format".to_string(),
            "stream-json".to_string(),
            "--input-format".to_string(),
            "stream-json".to_string(),
            "--verbose".to_string(),
            "--permission-mode".to_string(),
            "bypassPermissions".to_string(),
            "--dangerously-skip-permissions".to_string(),
        ];
        append_config_args(&mut args, &self.config);

        let mut cmd = Command::new(&self.config.claude_binary);
        cmd.args(&args);

        let mut child = cmd
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("failed to respawn `{}`: {}", self.config.claude_binary, e))?;

        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;

        let (event_tx, event_rx) = mpsc::channel::<RunnerEvent>(256);
        let stdin_tx = spawn_chat_stdin_writer(stdin);
        spawn_stream_readers(run_id, stdout, stderr, event_tx);

        info!("claude chat respawned with --resume {claude_session_id} for run {run_id}");
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
    data_dir
        .join("runs")
        .join(run_id.to_string())
        .join("output.jsonl")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autonomous_run_modes_map_to_expected_permissions() {
        assert!(matches!(
            permission_mode_for(&RunMode::Free, AutonomyLevel::Autonomous),
            PermissionMode::BypassAll
        ));
        assert!(matches!(
            permission_mode_for(&RunMode::Guided, AutonomyLevel::Autonomous),
            PermissionMode::AcceptEdits
        ));
        assert!(matches!(
            permission_mode_for(&RunMode::Strict, AutonomyLevel::Autonomous),
            PermissionMode::Default
        ));
    }

    #[test]
    fn review_plan_autonomy_forces_plan_mode_regardless_of_run_mode() {
        for mode in [RunMode::Free, RunMode::Guided, RunMode::Strict] {
            assert!(matches!(
                permission_mode_for(&mode, AutonomyLevel::ReviewPlan),
                PermissionMode::Plan
            ));
        }
    }

    #[test]
    fn permission_mode_cli_values_match_claude_cli() {
        assert_eq!(PermissionMode::BypassAll.cli_value(), "bypassPermissions");
        assert_eq!(PermissionMode::AcceptEdits.cli_value(), "acceptEdits");
        assert_eq!(PermissionMode::Plan.cli_value(), "plan");
        assert_eq!(PermissionMode::Default.cli_value(), "default");
    }

    #[test]
    fn claude_args_for_chat_includes_input_format() {
        let cfg = DaemonConfig::default();
        let args = claude_args_for("hi", &RunMode::Free, AutonomyLevel::Autonomous, &cfg, true, None);
        assert!(args
            .windows(2)
            .any(|w| w == ["--input-format", "stream-json"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["--output-format", "stream-json"]));
    }

    #[test]
    fn claude_args_for_oneshot_omits_input_format() {
        let cfg = DaemonConfig::default();
        let args = claude_args_for("hi", &RunMode::Free, AutonomyLevel::Autonomous, &cfg, false, None);
        assert!(!args.iter().any(|arg| arg == "--input-format"));
    }

    #[test]
    fn agent_args_add_model_and_system_prompt() {
        let cfg = DaemonConfig::default();
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "verifier".into(),
            role_id: Some("verifier".into()),
            personality_id: None,
            runner: Runner::Claude,
            legacy_role: None,
            description: String::new(),
            instructions: "Check the work and report evidence.".into(),
            model: Some("claude-opus".into()),
            default_autonomy: AutonomyLevel::Autonomous,
            created_at: now,
            updated_at: now,
        };
        let args = claude_args_for(
            "hi",
            &RunMode::Free,
            AutonomyLevel::Autonomous,
            &cfg,
            false,
            Some(&agent),
        );
        assert!(args.windows(2).any(|w| w == ["--model", "claude-opus"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["--append-system-prompt", "Check the work and report evidence."]));
    }

    #[test]
    fn hermes_args_carry_model_and_prepend_instructions() {
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "reviewer".into(),
            role_id: None,
            personality_id: None,
            runner: Runner::Hermes,
            legacy_role: None,
            description: String::new(),
            instructions: "Be adversarial.".into(),
            model: Some("anthropic/claude-sonnet-4.6".into()),
            default_autonomy: AutonomyLevel::default(),
            created_at: now,
            updated_at: now,
        };
        let args = hermes_args_for("review the diff", Some(&agent));
        assert!(args.windows(2).any(|w| w == ["-m", "anthropic/claude-sonnet-4.6"]));
        // hermes has no --append-system-prompt: instructions are prepended.
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.starts_with("Be adversarial."), "got {prompt:?}");
        assert!(prompt.ends_with("review the diff"), "got {prompt:?}");
        assert!(!args.iter().any(|a| a == "--append-system-prompt"));
    }

    #[test]
    fn hermes_args_without_agent_is_the_bare_prompt() {
        let args = hermes_args_for("hello", None);
        assert_eq!(args, vec!["-z".to_string(), "hello".to_string()]);
    }

    #[test]
    fn agent_args_absent_when_agent_has_no_model_or_instructions() {
        let cfg = DaemonConfig::default();
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "bare".into(),
            role_id: None,
            personality_id: None,
            runner: Runner::Claude,
            legacy_role: None,
            description: String::new(),
            instructions: "   ".into(),
            model: None,
            default_autonomy: AutonomyLevel::Autonomous,
            created_at: now,
            updated_at: now,
        };
        let args = claude_args_for(
            "hi",
            &RunMode::Free,
            AutonomyLevel::Autonomous,
            &cfg,
            false,
            Some(&agent),
        );
        assert!(!args.iter().any(|a| a == "--model"));
        assert!(!args.iter().any(|a| a == "--append-system-prompt"));
    }
    #[test]
    fn chat_user_message_line_writes_stream_json_user_turn() {
        let line = chat_user_message_line("hello");
        assert!(line.ends_with(char::from(10)));
        let value: serde_json::Value = serde_json::from_str(line.trim_end()).unwrap();
        assert_eq!(value["type"], "user");
        assert_eq!(value["message"]["role"], "user");
        assert_eq!(value["message"]["content"][0]["type"], "text");
        assert_eq!(value["message"]["content"][0]["text"], "hello");
    }

    #[test]
    fn claude_args_include_mcp_and_tool_filters_when_configured() {
        let cfg = DaemonConfig {
            mcp_config_path: Some(PathBuf::from("/tmp/mcp.json")),
            allowed_tools: Some(vec!["mcp__github__search".into(), "Read".into()]),
            disallowed_tools: Some(vec!["Bash".into()]),
            ..Default::default()
        };

        let args = claude_args_for(
            "ship it",
            &RunMode::Free,
            AutonomyLevel::Autonomous,
            &cfg,
            false,
            None,
        );

        assert!(args
            .windows(2)
            .any(|w| w == ["--mcp-config", "/tmp/mcp.json"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["--allowed-tools", "mcp__github__search,Read"]));
        assert!(args.windows(2).any(|w| w == ["--disallowed-tools", "Bash"]));
    }

    #[tokio::test]
    async fn preflight_reports_missing_binary() {
        let cfg = DaemonConfig {
            claude_binary: "definitely_not_a_real_binary_xyz_123".into(),
            ..Default::default()
        };
        let runner = ClaudeRunner::new(cfg);
        let err = runner.preflight().await.unwrap_err();
        assert!(err.reason.contains("not found"));
        assert!(err.suggestion.to_lowercase().contains("install"));
    }

    #[test]
    fn empty_prompt_rejected() {
        let cfg = DaemonConfig {
            claude_binary: "echo".into(),
            ..Default::default()
        };
        let runner = ClaudeRunner::new(cfg);
        let err = runner
            .spawn(
                Uuid::new_v4(),
                "",
                &RunMode::Free,
                AutonomyLevel::Autonomous,
                None,
                Path::new("/tmp"),
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("empty"));
    }

    #[test]
    fn whitespace_only_prompt_rejected() {
        let cfg = DaemonConfig {
            claude_binary: "echo".into(),
            ..Default::default()
        };
        let runner = ClaudeRunner::new(cfg);
        let err = runner
            .spawn(
                Uuid::new_v4(),
                "   \n\t  ",
                &RunMode::Free,
                AutonomyLevel::Autonomous,
                None,
                Path::new("/tmp"),
            )
            .unwrap_err();
        assert!(err.to_lowercase().contains("empty"));
    }
}
