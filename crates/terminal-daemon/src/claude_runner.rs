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

use crate::parser::{HermesStreamParser, ParseEvent, StreamParser};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use terminal_core::config::DaemonConfig;
use terminal_core::models::{Agent, AutonomyLevel, NoticeLevel, RunMode, Runner};
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
    /// Token-level text delta from a partial-message stream. The UI renders it
    /// live and drops the buffer when the committed text arrives.
    AssistantDelta(String),
    /// Run chrome: rate limits, compaction, unmodelled stream events. Shown as
    /// a notice, never mixed into the readable output log.
    Notice {
        level: NoticeLevel,
        message: String,
    },
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

    // Token-level streaming. Without this the model's text arrives only as a
    // completed `assistant` block, so a long run shows nothing until it is
    // done. `stream_event` deltas are consumed by the parser and rendered live;
    // the committed block then replaces them, so nothing is shown twice.
    if !chat {
        args.push("--include-partial-messages".to_string());
    }

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

/// The autonomy choice, as an instruction Hermes can act on.
///
/// Claude enforces autonomy with `--permission-mode` — a real gate. Hermes has
/// no equivalent flag and no sandbox for it, so without this the UI's
/// Autonomous / Plan-first toggle was silently inert: a user could pick
/// "Autonomous", drive a Planner agent, and get a plan with nothing written,
/// with no indication that their choice had been dropped on the floor. A
/// directive in the prompt is the only lever Hermes exposes, so the honest fix
/// is to use it and say what it is.
fn autonomy_directive(autonomy: AutonomyLevel) -> &'static str {
    match autonomy {
        AutonomyLevel::Autonomous => {
            "AUTONOMY: EXECUTE. Carry out the requested work in this working copy now — make the \
             edits and run the commands. Do not stop to present a plan first; a plan is not the \
             deliverable. Any planning guidance above describes how to work, not licence to stop \
             early."
        }
        AutonomyLevel::ReviewPlan => {
            "AUTONOMY: PLAN ONLY. Do not create, edit or delete any file and do not run any \
             state-changing command. Produce a plan describing exactly what you would do, then stop."
        }
    }
}

/// Fold a driving agent into a `hermes chat --format stream-json` invocation.
///
/// This used to be `hermes -z <prompt>`, which prints ONLY the final response
/// text to stdout. That made every Hermes run opaque: a long run showed nothing
/// at all until it finished, and the panel looked hung. `chat --format
/// stream-json` emits one JSON object per line — `system/init`, `text` deltas,
/// `tool_use` / `tool_result`, then a terminal `result` envelope — so Hermes
/// runs now stream like Claude runs do, with tool cards and token metrics.
///
/// Hermes has no `--append-system-prompt`, so the agent's composed instructions
/// and the autonomy directive are prepended to the query as an explicit
/// preamble: the only lever it exposes.
fn hermes_args_for(prompt: &str, agent: Option<&Agent>, autonomy: AutonomyLevel) -> Vec<String> {
    let mut args = Vec::new();
    // Profile first: `-p` is Hermes' pre-argparse profile flag, and it re-homes
    // the child onto that profile's config (model set, providers, skills,
    // memory). It must not be mistaken for a flag of the subcommand.
    if let Some(profile) = agent
        .and_then(|a| a.profile.as_ref())
        .filter(|p| !p.trim().is_empty())
    {
        args.push("-p".to_string());
        args.push(profile.clone());
    }
    args.push("chat".to_string());
    if let Some(model) = agent
        .and_then(|a| a.model.as_ref())
        .filter(|m| !m.trim().is_empty())
    {
        args.push("-m".to_string());
        args.push(model.clone());
    }
    // `--provider` picks the inference provider (e.g. `openrouter`, `nous`).
    // The profile already carries a default; this is the per-agent override.
    if let Some(provider) = agent
        .and_then(|a| a.provider.as_ref())
        .filter(|p| !p.trim().is_empty())
    {
        args.push("--provider".to_string());
        args.push(provider.clone());
    }
    args.push("--format".to_string());
    args.push("stream-json".to_string());
    args.push("--oneshot".to_string());
    args.push("-q".to_string());

    let mut preamble = String::new();
    if let Some(a) = agent.filter(|a| !a.instructions.trim().is_empty()) {
        preamble.push_str(a.instructions.trim());
        preamble.push_str("\n\n---\n\n");
    }
    preamble.push_str(autonomy_directive(autonomy));
    preamble.push_str("\n\n---\n\n");
    preamble.push_str(prompt);

    args.push(preamble);
    args
}

/// Read a hermes `--format stream-json` run into the shared `RunnerEvent`
/// channel. Hermes emits the same high-level shapes Claude does (`system/init`,
/// `text` deltas, `tool_use`/`tool_result`, terminal `result`), so its parser
/// produces identical `ParseEvent`s and the supervisor needs no special case.
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
        let mut parser = HermesStreamParser::new();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    for event in parser.feed_line(&line) {
                        for mapped in map_parse_events(event) {
                            let _ = event_tx_stdout.send(mapped).await;
                        }
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    error!("hermes stdout read error: {e}");
                    break;
                }
            }
        }
        // The terminal `result` event sets `ResultSeen`; this is the belt-and-
        // braces case where the stream ends without one (crash, kill), so the
        // supervisor reports a failed run instead of "stream ended".
        let _ = event_tx_stdout.send(RunnerEvent::ResultSeen).await;
        debug!("hermes stdout reader finished for run {run_id}");
    });

    let event_tx_stderr = event_tx;
    tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            // Hermes writes diagnostics and the `session_id:` footer to stderr.
            // Those are chrome, not output — the JSON stream carries the answer.
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

/// Map one parser event onto the runner channel. Both dialects share this so the
/// Claude and Hermes readers cannot drift in how they treat an event — a `text`
/// delta in either language becomes the same `RunnerEvent`.
fn map_parse_events(event: ParseEvent) -> Vec<RunnerEvent> {
    match event {
        // Committed assistant text is split per line so it lands in the log the
        // way the model wrote it. Deltas are fragments, never split.
        ParseEvent::AssistantText(text) => {
            if text.is_empty() {
                Vec::new()
            } else {
                text.split_inclusive('\n')
                    .map(|line| RunnerEvent::AssistantText(line.to_string()))
                    .collect()
            }
        }
        ParseEvent::AssistantDelta(text) => vec![RunnerEvent::AssistantDelta(text)],
        ParseEvent::ToolUse { id, name, input_preview } => {
            vec![RunnerEvent::ToolUse { id, name, input_preview }]
        }
        ParseEvent::ExitPlanMode { tool_use_id, plan } => {
            vec![RunnerEvent::ExitPlanMode { tool_use_id, plan }]
        }
        ParseEvent::ToolResult { tool_use_id, is_error, preview } => {
            vec![RunnerEvent::ToolResult { tool_use_id, is_error, preview }]
        }
        ParseEvent::SessionInit { model, session_id } => {
            vec![RunnerEvent::SessionInit { model, session_id }]
        }
        ParseEvent::Notice { level, message } => vec![RunnerEvent::Notice { level, message }],
        ParseEvent::RawLine(line) => vec![RunnerEvent::StdoutLine(line)],
        ParseEvent::Result {
            success,
            subtype,
            num_turns,
            cost_usd,
            input_tokens,
            output_tokens,
            error_text,
        } => {
            let mut out = Vec::new();
            // Only a successful result sets ResultSeen: the supervisor reads a
            // missing ResultSeen at stream end as "died mid-stream", so a failed
            // result must not masquerade as one.
            if success {
                out.push(RunnerEvent::ResultSeen);
            }
            out.push(RunnerEvent::Metrics {
                num_turns,
                cost_usd,
                input_tokens,
                output_tokens,
            });
            if !success {
                out.push(RunnerEvent::Notice {
                    level: NoticeLevel::Error,
                    message: error_text.unwrap_or_else(|| format!("run failed: {subtype}")),
                });
            }
            out
        }
    }
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
                for mapped in map_parse_events(event) {
                    let _ = event_tx_stdout.send(mapped).await;
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
                hermes_args_for(prompt, agent, autonomy),
            ),
        };

        let mut cmd = Command::new(&binary);
        cmd.args(&args);

        let mut child = cmd
            .current_dir(working_dir)
            // The prompt travels in argv, so nothing ever writes to stdin. A
            // piped-but-silent stdin made the CLI warn "no stdin data received
            // in 3s" and printed that into the run's output; null gives an
            // immediate, honest EOF.
            .stdin(Stdio::null())
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
    fn claude_args_for_oneshot_requests_partial_messages() {
        // Token-level streaming is what stops a long run looking frozen.
        let cfg = DaemonConfig::default();
        let args = claude_args_for("hi", &RunMode::Free, AutonomyLevel::Autonomous, &cfg, false, None);
        assert!(args.iter().any(|arg| arg == "--include-partial-messages"));
        // Chat mode keeps a JSON input stream; partial messages are one-shot only.
        let chat = claude_args_for("hi", &RunMode::Free, AutonomyLevel::Autonomous, &cfg, true, None);
        assert!(!chat.iter().any(|arg| arg == "--include-partial-messages"));
    }

    #[test]
    fn failed_result_never_sets_result_seen() {
        // `ResultSeen` is the supervisor's "stream ended cleanly" signal. A
        // failed `result` envelope must not set it, or a rate-limited run would
        // be reported as a completed one.
        let failed = map_parse_events(ParseEvent::Result {
            success: false,
            subtype: "error".into(),
            num_turns: 1,
            cost_usd: 0.0,
            input_tokens: 10,
            output_tokens: 0,
            error_text: Some("usage limit reached".into()),
        });
        assert!(
            !failed.iter().any(|e| matches!(e, RunnerEvent::ResultSeen)),
            "failed result must not look like a clean finish: {failed:?}"
        );
        // The reason is carried as an error-level notice, which the supervisor
        // promotes to the RunFailed message.
        assert!(failed.iter().any(|e| matches!(
            e,
            RunnerEvent::Notice { level: NoticeLevel::Error, message } if message == "usage limit reached"
        )));
        // Metrics still flow, so the panel can show tokens even for a failure.
        assert!(failed.iter().any(|e| matches!(e, RunnerEvent::Metrics { input_tokens: 10, .. })));

        let ok = map_parse_events(ParseEvent::Result {
            success: true,
            subtype: "success".into(),
            num_turns: 1,
            cost_usd: 0.0,
            input_tokens: 1,
            output_tokens: 1,
            error_text: None,
        });
        assert!(ok.iter().any(|e| matches!(e, RunnerEvent::ResultSeen)));
    }

    #[test]
    fn assistant_text_is_split_per_line_but_deltas_are_not() {
        let text = map_parse_events(ParseEvent::AssistantText("one\ntwo\n".into()));
        assert_eq!(text.len(), 2, "committed text splits per line: {text:?}");

        // A delta is a fragment mid-word; splitting it would corrupt the stream.
        let delta = map_parse_events(ParseEvent::AssistantDelta("O Dou".into()));
        assert!(matches!(delta.as_slice(), [RunnerEvent::AssistantDelta(t)] if t == "O Dou"));
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
            provider: None,
            profile: None,
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
    fn claude_args_ignore_provider_and_profile() {
        // Provider/profile are Hermes levers. Claude Code takes neither flag, so
        // they must not leak into its argv (the UI hides them for Claude too).
        let cfg = DaemonConfig::default();
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "claude-worker".into(),
            role_id: None,
            personality_id: None,
            runner: Runner::Claude,
            legacy_role: None,
            description: String::new(),
            instructions: String::new(),
            model: None,
            provider: Some("openrouter".into()),
            profile: Some("fast".into()),
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
        // `-p` here is Claude's own print flag (its value is the prompt), not a
        // Hermes profile: the pins must not appear anywhere in the argv.
        assert_eq!(args.first().map(String::as_str), Some("-p"));
        assert_eq!(args.get(1).map(String::as_str), Some("hi"));
        assert!(!args.iter().any(|a| a == "--provider"));
        assert!(!args.iter().any(|a| a == "openrouter" || a == "fast"));
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
            provider: Some("openrouter".into()),
            profile: Some("fast".into()),
            default_autonomy: AutonomyLevel::default(),
            created_at: now,
            updated_at: now,
        };
        let args = hermes_args_for("review the diff", Some(&agent), AutonomyLevel::Autonomous);
        assert!(args.windows(2).any(|w| w == ["-p", "fast"]));
        assert!(args.windows(2).any(|w| w == ["-m", "anthropic/claude-sonnet-4.6"]));
        assert!(args.windows(2).any(|w| w == ["--provider", "openrouter"]));
        // The profile flag is pre-argparse: it must lead the invocation.
        assert_eq!(args.first().map(String::as_str), Some("-p"));
        // hermes has no --append-system-prompt: instructions are prepended.
        let prompt = args.last().expect("prompt arg");
        assert!(prompt.starts_with("Be adversarial."), "got {prompt:?}");
        assert!(prompt.ends_with("review the diff"), "got {prompt:?}");
        assert!(!args.iter().any(|a| a == "--append-system-prompt"));
    }

    #[test]
    fn hermes_args_use_the_stream_json_protocol() {
        // `-z` printed only the final text, so a long Hermes run showed nothing
        // until it finished. This asserts the streaming invocation replaces it.
        let args = hermes_args_for("hello", None, AutonomyLevel::Autonomous);
        assert_eq!(args[0], "chat");
        assert!(args.windows(2).any(|w| w == ["--format", "stream-json"]));
        assert!(args.contains(&"--oneshot".to_string()));
        assert!(args.windows(2).any(|w| w == ["-q", args.last().unwrap()]));
        // `-z` must be gone: it is the flag that produced no streaming.
        assert!(!args.iter().any(|a| a == "-z"));
        // The prompt carries the autonomy directive (Hermes has no
        // permission-mode flag, so this is the only lever).
        let prompt = args.last().unwrap();
        assert!(prompt.contains("AUTONOMY: EXECUTE"), "{prompt}");
        assert!(prompt.ends_with("hello"), "{prompt}");
    }

    #[test]
    fn hermes_plan_first_asks_for_a_plan_and_no_writes() {
        // The autonomy toggle used to be silently inert on Hermes: it only ever
        // became a Claude `--permission-mode`, so the user's choice vanished.
        let plan = hermes_args_for("do the thing", None, AutonomyLevel::ReviewPlan);
        let prompt = plan.last().unwrap();
        assert!(prompt.contains("AUTONOMY: PLAN ONLY"), "{prompt}");
        assert!(prompt.contains("Do not create, edit or delete any file"), "{prompt}");
    }

    #[test]
    fn hermes_preamble_orders_instructions_then_autonomy_then_prompt() {
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "planner".into(),
            role_id: None,
            personality_id: None,
            runner: Runner::Hermes,
            legacy_role: None,
            description: String::new(),
            instructions: "Produce a plan and stop.".into(),
            model: Some("deepseek-v4.1-flash".into()),
            provider: Some("ollama-cloud".into()),
            profile: Some("fast".into()),
            default_autonomy: AutonomyLevel::ReviewPlan,
            created_at: now,
            updated_at: now,
        };
        let args = hermes_args_for("ship it", Some(&agent), AutonomyLevel::Autonomous);
        let prompt = args.last().unwrap();

        let i_role = prompt.find("Produce a plan and stop.").expect("role instructions");
        let i_auto = prompt.find("AUTONOMY: EXECUTE").expect("autonomy directive");
        let i_task = prompt.find("ship it").expect("task");
        // Last word wins for a model reading top-to-bottom, so the directive
        // sits after the role text and before the task.
        assert!(i_role < i_auto && i_auto < i_task, "{prompt}");
        // Profile/model/provider still become real flags.
        assert!(args.windows(2).any(|w| w == ["-p", "fast"]));
        assert!(args.windows(2).any(|w| w == ["-m", "deepseek-v4.1-flash"]));
        assert!(args.windows(2).any(|w| w == ["--provider", "ollama-cloud"]));
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
            provider: None,
            profile: None,
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

    /// End-to-end through the real spawn path. A stub binary stands in for the
    /// hermes CLI and echoes its own argv, so what the runner actually execs is
    /// read back from the child's stdout: no network, no model, no quota.
    #[tokio::test]
    async fn hermes_spawn_forwards_profile_model_and_provider() {
        let now = chrono::Utc::now();
        let agent = Agent {
            id: Uuid::new_v4(),
            name: "reviewer".into(),
            role_id: None,
            personality_id: None,
            runner: Runner::Hermes,
            legacy_role: None,
            description: String::new(),
            instructions: String::new(),
            model: Some("anthropic/claude-sonnet-4.6".into()),
            provider: Some("openrouter".into()),
            profile: Some("fast".into()),
            default_autonomy: AutonomyLevel::default(),
            created_at: now,
            updated_at: now,
        };
        let cfg = DaemonConfig {
            hermes_binary: "/bin/echo".into(),
            ..Default::default()
        };
        let runner = ClaudeRunner::new(cfg);
        let (mut rx, mut child) = runner
            .spawn(
                Uuid::new_v4(),
                "hello",
                &RunMode::Free,
                AutonomyLevel::Autonomous,
                Some(&agent),
                Path::new("/tmp"),
            )
            .expect("spawn");

        let mut lines: Vec<String> = Vec::new();
        loop {
            let next = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv()).await;
            match next {
                Ok(Some(RunnerEvent::StdoutLine(line))) => lines.push(line),
                Ok(Some(RunnerEvent::ResultSeen)) | Ok(None) => break,
                Ok(Some(_)) => {}
                Err(_) => panic!("timed out waiting for the stub to finish"),
            }
        }
        let _ = child.wait();
        let argv = lines.join(" ");
        assert!(argv.contains("-p fast"), "profile missing from argv: {argv}");
        assert!(
            argv.contains("-m anthropic/claude-sonnet-4.6"),
            "model missing from argv: {argv}"
        );
        assert!(
            argv.contains("--provider openrouter"),
            "provider missing from argv: {argv}"
        );
        assert!(argv.trim_end().ends_with("hello"), "prompt missing: {argv}");
    }
}
