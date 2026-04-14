use crate::parser::{delimiter_preamble, ParseEvent, StreamParser};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use terminal_core::config::DaemonConfig;
use terminal_core::models::RunMode;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tracing::{error, info};
use uuid::Uuid;

/// Events emitted by the Claude runner to the supervisor.
#[derive(Debug)]
#[allow(dead_code)]
pub enum RunnerEvent {
    /// A line of output from stdout
    StdoutLine(String),
    /// A line of output from stderr
    StderrLine(String),
    /// Parser detected a blocking question
    BlockingDetected(String),
    /// Process exited
    ProcessExited { exit_code: Option<i32> },
    /// Malformed output at process end
    MalformedOutput { partial: String },
    /// Error spawning or running
    SpawnError(String),
}

pub struct ClaudeRunner {
    config: DaemonConfig,
}

impl ClaudeRunner {
    pub fn new(config: DaemonConfig) -> Self {
        Self { config }
    }

    /// Spawn claude -p with the given prompt.
    /// Returns:
    /// - event receiver (RunnerEvent stream)
    /// - stdin sender (for responding to blocking questions)
    /// - child process handle
    pub fn spawn(
        &self,
        run_id: Uuid,
        prompt: &str,
        _mode: &RunMode,
        working_dir: &Path,
    ) -> Result<(mpsc::Receiver<RunnerEvent>, mpsc::Sender<String>, Child), String> {
        if prompt.trim().is_empty() {
            return Err("Cannot start run with empty prompt".into());
        }

        let full_prompt = format!("{}\n\n{}", delimiter_preamble(), prompt);

        let mut child = Command::new(&self.config.claude_binary)
            .args(["-p", &full_prompt])
            .current_dir(working_dir)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        let stdout = child.stdout.take().ok_or("No stdout")?;
        let stderr = child.stderr.take().ok_or("No stderr")?;

        let (event_tx, event_rx) = mpsc::channel::<RunnerEvent>(256);
        let (stdin_tx, mut stdin_rx) = mpsc::channel::<String>(16);

        // Stdout reader task
        let event_tx_stdout = event_tx.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut parser = StreamParser::new();

            while let Ok(Some(line)) = lines.next_line().await {
                let events = parser.feed_line(&line);
                for event in events {
                    match event {
                        ParseEvent::OutputLine(l) => {
                            let _ = event_tx_stdout.send(RunnerEvent::StdoutLine(l)).await;
                        }
                        ParseEvent::BlockingDetected(q) => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::BlockingDetected(q))
                                .await;
                        }
                        ParseEvent::ResultStart | ParseEvent::ResultEnd => {
                            // State transitions handled by parser internally
                        }
                        ParseEvent::MalformedEnd { partial, .. } => {
                            let _ = event_tx_stdout
                                .send(RunnerEvent::MalformedOutput { partial })
                                .await;
                        }
                    }
                }
            }

            // Finalize parser
            if let Some(event) = parser.finalize() {
                if let ParseEvent::MalformedEnd { partial, .. } = event {
                    let _ = event_tx_stdout
                        .send(RunnerEvent::MalformedOutput { partial })
                        .await;
                }
            }
        });

        // Stderr reader task
        let event_tx_stderr = event_tx.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                let _ = event_tx_stderr.send(RunnerEvent::StderrLine(line)).await;
            }
        });

        // Stdin writer task (for responding to blocking questions)
        let mut stdin_handle = child.stdin.take();
        tokio::spawn(async move {
            if let Some(ref mut stdin) = stdin_handle {
                while let Some(response) = stdin_rx.recv().await {
                    if let Err(e) = stdin.write_all(response.as_bytes()).await {
                        error!("Failed to write to claude stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin.write_all(b"\n").await {
                        error!("Failed to write newline to claude stdin: {}", e);
                        break;
                    }
                    if let Err(e) = stdin.flush().await {
                        error!("Failed to flush claude stdin: {}", e);
                        break;
                    }
                }
            }
        });

        info!("Claude process spawned for run {}", run_id);
        Ok((event_rx, stdin_tx, child))
    }
}

/// Get the output file path for a given run.
pub fn output_file_path(data_dir: &Path, run_id: &Uuid) -> PathBuf {
    data_dir.join("runs").join(run_id.to_string()).join("output.jsonl")
}

#[cfg(test)]
mod tests {
    use super::*;
    use terminal_core::config::{DaemonConfig, DaemonMode};
    use terminal_core::models::RunMode;
    use std::path::PathBuf;

    fn test_config() -> DaemonConfig {
        DaemonConfig {
            claude_binary: "echo".to_string(), // safe dummy binary
            mode: DaemonMode::Embedded,
            data_dir: PathBuf::from("/tmp/test-daemon"),
            ..DaemonConfig::default()
        }
    }

    #[test]
    fn empty_prompt_rejected() {
        let runner = ClaudeRunner::new(test_config());
        let result = runner.spawn(
            Uuid::new_v4(),
            "",
            &RunMode::Free,
            &PathBuf::from("/tmp"),
        );
        assert!(result.is_err(), "Empty prompt should be rejected");
        assert!(result.unwrap_err().contains("empty"), "Error should mention empty prompt");
    }

    #[test]
    fn whitespace_only_prompt_rejected() {
        let runner = ClaudeRunner::new(test_config());
        let result = runner.spawn(
            Uuid::new_v4(),
            "   \n\t  ",
            &RunMode::Free,
            &PathBuf::from("/tmp"),
        );
        assert!(result.is_err(), "Whitespace-only prompt should be rejected");
    }

    #[tokio::test]
    async fn normal_prompt_accepted() {
        let runner = ClaudeRunner::new(test_config());
        let result = runner.spawn(
            Uuid::new_v4(),
            "Fix the bug in auth.rs",
            &RunMode::Free,
            &PathBuf::from("/tmp"),
        );
        assert!(result.is_ok(), "Normal prompt should be accepted: {:?}", result.err());
    }

    #[test]
    fn spawn_error_on_missing_binary() {
        let mut config = test_config();
        config.claude_binary = "/nonexistent/binary/path".to_string();
        let runner = ClaudeRunner::new(config);
        let result = runner.spawn(
            Uuid::new_v4(),
            "hello",
            &RunMode::Free,
            &PathBuf::from("/tmp"),
        );
        assert!(result.is_err(), "Missing binary should return error");
        assert!(result.unwrap_err().contains("spawn"), "Error should mention spawn failure");
    }
}
