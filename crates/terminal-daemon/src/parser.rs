//! Stream-JSON parser for Claude Code's `--output-format stream-json` output.
//!
//! Claude Code emits one JSON object per line. We care about these types:
//!
//! - `system` with `subtype: "init"` — session start, reports tools + model
//! - `assistant` — model turn with content blocks (`text`, `tool_use`)
//! - `user` — tool results (after Claude calls a tool)
//! - `result` — run terminated: may be `success` or error subtype, carries
//!   `num_turns`, `total_cost_usd`, `usage` (input/output tokens)
//!
//! We translate these into `ParseEvent`s consumed by the runner supervisor.
//! Unknown / malformed lines are surfaced as `RawLine` so nothing is lost.

use serde::Deserialize;

/// Events emitted by the parser. The supervisor maps these onto
/// `RunnerEvent`s and ultimately onto protocol `AppEvent`s.
#[derive(Debug, Clone, PartialEq)]
pub enum ParseEvent {
    /// Session initialized; carries the model id if provided.
    SessionInit { model: Option<String>, session_id: Option<String> },
    /// Assistant emitted text (may be partial across multiple events).
    AssistantText(String),
    /// Assistant called a tool.
    ToolUse {
        id: String,
        name: String,
        /// A short, human-readable preview of the tool input (e.g. file path,
        /// first line of a bash command). Full input is in the raw log.
        input_preview: String,
    },
    /// Claude called the built-in ExitPlanMode tool with a plan ready for review.
    ExitPlanMode {
        tool_use_id: String,
        plan: String,
    },
    /// A tool call returned a result.
    ToolResult {
        tool_use_id: String,
        is_error: bool,
        preview: String,
    },
    /// Final event: the run finished.
    Result {
        success: bool,
        subtype: String,
        num_turns: u32,
        cost_usd: f64,
        input_tokens: u64,
        output_tokens: u64,
        error_text: Option<String>,
    },
    /// Line that didn't parse as JSON or wasn't a recognized shape.
    /// Preserved so nothing is silently dropped.
    RawLine(String),
}

// --- Wire structs (deserialized from Claude's stream-json output). -----------

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum WireEvent {
    #[serde(rename = "system")]
    System {
        subtype: Option<String>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        session_id: Option<String>,
    },
    #[serde(rename = "assistant")]
    Assistant { message: AssistantMessage },
    #[serde(rename = "user")]
    User { message: UserMessage },
    #[serde(rename = "result")]
    Result(ResultEvent),
}

#[derive(Debug, Deserialize)]
struct AssistantMessage {
    #[serde(default)]
    content: Vec<AssistantBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum AssistantBlock {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        id: String,
        name: String,
        #[serde(default)]
        input: serde_json::Value,
    },
    /// Anything we don't care to model (e.g. "thinking", future types).
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct UserMessage {
    #[serde(default)]
    content: Vec<UserBlock>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum UserBlock {
    #[serde(rename = "tool_result")]
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        is_error: bool,
        #[serde(default)]
        content: serde_json::Value,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
struct ResultEvent {
    #[serde(default)]
    subtype: Option<String>,
    #[serde(default)]
    is_error: Option<bool>,
    #[serde(default)]
    num_turns: Option<u32>,
    #[serde(default, alias = "total_cost_usd", alias = "cost_usd")]
    total_cost_usd: Option<f64>,
    #[serde(default)]
    usage: Option<UsageStats>,
    #[serde(default)]
    result: Option<String>,
    #[serde(default)]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UsageStats {
    #[serde(default)]
    input_tokens: Option<u64>,
    #[serde(default)]
    output_tokens: Option<u64>,
}

// --- Parser ------------------------------------------------------------------

pub struct StreamParser;

impl StreamParser {
    pub fn new() -> Self {
        Self
    }

    /// Parse a single line of Claude stream-json output into zero or more
    /// high-level events. Non-JSON lines are preserved as `RawLine`.
    pub fn feed_line(&mut self, line: &str) -> Vec<ParseEvent> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let wire: WireEvent = match serde_json::from_str(trimmed) {
            Ok(w) => w,
            Err(_) => return vec![ParseEvent::RawLine(line.to_string())],
        };

        match wire {
            WireEvent::System { subtype, model, session_id } => {
                if subtype.as_deref() == Some("init") {
                    vec![ParseEvent::SessionInit { model, session_id }]
                } else {
                    Vec::new()
                }
            }
            WireEvent::Assistant { message } => {
                let mut out = Vec::new();
                for block in message.content {
                    match block {
                        AssistantBlock::Text { text } => {
                            if !text.is_empty() {
                                out.push(ParseEvent::AssistantText(text));
                            }
                        }
                        AssistantBlock::ToolUse { id, name, input } => {
                            if name == "ExitPlanMode" {
                                let plan = input
                                    .get("plan")
                                    .and_then(|value| value.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                out.push(ParseEvent::ExitPlanMode {
                                    tool_use_id: id,
                                    plan,
                                });
                            } else {
                                out.push(ParseEvent::ToolUse {
                                    id,
                                    input_preview: tool_input_preview(&name, &input),
                                    name,
                                });
                            }
                        }
                        AssistantBlock::Other => {}
                    }
                }
                out
            }
            WireEvent::User { message } => {
                let mut out = Vec::new();
                for block in message.content {
                    if let UserBlock::ToolResult { tool_use_id, is_error, content } = block {
                        out.push(ParseEvent::ToolResult {
                            tool_use_id,
                            is_error,
                            preview: tool_result_preview(&content),
                        });
                    }
                }
                out
            }
            WireEvent::Result(r) => {
                let subtype = r.subtype.clone().unwrap_or_else(|| "unknown".into());
                let success = r.is_error.map(|e| !e).unwrap_or(subtype == "success");
                let cost_usd = r.total_cost_usd.unwrap_or(0.0);
                let (input_tokens, output_tokens) = r
                    .usage
                    .as_ref()
                    .map(|u| (u.input_tokens.unwrap_or(0), u.output_tokens.unwrap_or(0)))
                    .unwrap_or((0, 0));
                let error_text = if success {
                    None
                } else {
                    r.error.or(r.result).or_else(|| Some(subtype.clone()))
                };
                vec![ParseEvent::Result {
                    success,
                    subtype,
                    num_turns: r.num_turns.unwrap_or(0),
                    cost_usd,
                    input_tokens,
                    output_tokens,
                    error_text,
                }]
            }
        }
    }
}

impl Default for StreamParser {
    fn default() -> Self {
        Self::new()
    }
}

/// Short one-line summary of a tool call's input, safe to show in UI chrome.
fn tool_input_preview(name: &str, input: &serde_json::Value) -> String {
    let pick = |keys: &[&str]| -> Option<String> {
        for k in keys {
            if let Some(v) = input.get(*k).and_then(|v| v.as_str()) {
                return Some(v.to_string());
            }
        }
        None
    };

    let candidate = match name {
        "Edit" | "Write" | "Read" | "MultiEdit" | "NotebookEdit" => {
            pick(&["file_path", "path", "notebook_path"])
        }
        "Bash" => pick(&["command"]).map(|c| first_line(&c, 120)),
        "Grep" | "Search" => pick(&["pattern"]),
        "Glob" => pick(&["pattern"]),
        "WebFetch" | "WebSearch" => pick(&["url", "query"]),
        _ => None,
    };

    candidate.unwrap_or_else(|| summarize_value(input, 120))
}

fn tool_result_preview(content: &serde_json::Value) -> String {
    // tool_result's `content` is either a string or an array of blocks with
    // `type: "text"`. Collapse to a short string.
    if let Some(s) = content.as_str() {
        return first_line(s, 200);
    }
    if let Some(arr) = content.as_array() {
        for block in arr {
            if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                return first_line(text, 200);
            }
        }
    }
    summarize_value(content, 200)
}

fn first_line(s: &str, max: usize) -> String {
    let first = s.lines().next().unwrap_or("").trim();
    truncate(first, max)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

fn summarize_value(v: &serde_json::Value, max: usize) -> String {
    let compact = serde_json::to_string(v).unwrap_or_default();
    truncate(&compact, max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_system_init() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"system","subtype":"init","session_id":"s1","model":"claude-sonnet-4-5","cwd":"/tmp","tools":["Edit"]}"#,
        );
        assert_eq!(
            ev,
            vec![ParseEvent::SessionInit {
                model: Some("claude-sonnet-4-5".into()),
                session_id: Some("s1".into()),
            }]
        );
    }

    #[test]
    fn parses_assistant_text() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"hi there"}]}}"#,
        );
        assert_eq!(ev, vec![ParseEvent::AssistantText("hi there".into())]);
    }

    #[test]
    fn parses_tool_use_edit() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"src/main.rs","old_string":"a","new_string":"b"}}]}}"#,
        );
        assert_eq!(
            ev,
            vec![ParseEvent::ToolUse {
                id: "t1".into(),
                name: "Edit".into(),
                input_preview: "src/main.rs".into(),
            }]
        );
    }

    #[test]
    fn parses_tool_use_bash_trims_to_first_line() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"echo hello\nls -la"}}]}}"#,
        );
        match &ev[0] {
            ParseEvent::ToolUse { input_preview, .. } => {
                assert_eq!(input_preview, "echo hello");
            }
            _ => panic!("expected ToolUse"),
        }
    }

    #[test]
    fn parses_exit_plan_mode_tool_use() {
        let mut p = StreamParser::new();
        let events = p.feed_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"abc123","name":"ExitPlanMode","input":{"plan":"1. edit foo\n2. add test"}}]}}"#,
        );
        assert_eq!(events.len(), 1);
        match &events[0] {
            ParseEvent::ExitPlanMode { tool_use_id, plan } => {
                assert_eq!(tool_use_id, "abc123");
                assert_eq!(plan, "1. edit foo\n2. add test");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn other_tool_use_still_emits_tool_use() {
        let mut p = StreamParser::new();
        let events = p.feed_line(
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"Edit","input":{"file_path":"/tmp/a"}}]}}"#,
        );
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], ParseEvent::ToolUse { .. }));
    }

    #[test]
    fn parses_tool_result_text_array() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":false,"content":[{"type":"text","text":"ok"}]}]}}"#,
        );
        assert_eq!(
            ev,
            vec![ParseEvent::ToolResult {
                tool_use_id: "t1".into(),
                is_error: false,
                preview: "ok".into(),
            }]
        );
    }

    #[test]
    fn parses_result_success() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"result","subtype":"success","is_error":false,"num_turns":2,"total_cost_usd":0.0123,"usage":{"input_tokens":500,"output_tokens":250}}"#,
        );
        match &ev[0] {
            ParseEvent::Result { success, num_turns, cost_usd, input_tokens, output_tokens, .. } => {
                assert!(*success);
                assert_eq!(*num_turns, 2);
                assert!((*cost_usd - 0.0123).abs() < 1e-9);
                assert_eq!(*input_tokens, 500);
                assert_eq!(*output_tokens, 250);
            }
            _ => panic!("expected Result"),
        }
    }

    #[test]
    fn parses_result_error() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":10,"total_cost_usd":0.5}"#,
        );
        match &ev[0] {
            ParseEvent::Result { success, subtype, error_text, .. } => {
                assert!(!*success);
                assert_eq!(subtype, "error_max_turns");
                assert!(error_text.is_some());
            }
            _ => panic!("expected Result"),
        }
    }

    #[test]
    fn non_json_falls_back_to_raw_line() {
        let mut p = StreamParser::new();
        let ev = p.feed_line("this is not json");
        assert_eq!(ev, vec![ParseEvent::RawLine("this is not json".into())]);
    }

    #[test]
    fn empty_line_yields_nothing() {
        let mut p = StreamParser::new();
        assert!(p.feed_line("").is_empty());
        assert!(p.feed_line("   ").is_empty());
    }

    #[test]
    fn unknown_event_type_is_silent() {
        let mut p = StreamParser::new();
        // Unknown top-level type → serde_json error on untagged enum,
        // falls back to RawLine.
        let ev = p.feed_line(r#"{"type":"future_event_kind","foo":1}"#);
        assert!(matches!(ev.as_slice(), [ParseEvent::RawLine(_)]));
    }
}
