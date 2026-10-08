//! Stream-JSON parsers for runner output.
//!
//! Two dialects share this module, both one JSON object per stdout line:
//!
//! **Claude Code** (`--output-format stream-json`):
//! - `system` with `subtype: "init"` — session start, reports tools + model
//! - `assistant` — model turn with content blocks (`text`, `tool_use`)
//! - `user` — tool results (after Claude calls a tool)
//! - `result` — run terminated: may be `success` or error subtype, carries
//!   `num_turns`, `total_cost_usd`, `usage` (input/output tokens)
//! - `stream_event` with `--include-partial-messages` — token deltas
//!
//! **Hermes** (`hermes chat --format stream-json`):
//! - `system`/`init`, then `text` deltas, `tool_use` / `tool_result`, and one
//!   terminal `result` envelope (exit code, final text, token stats)
//!
//! We translate these into `ParseEvent`s consumed by the runner supervisor.
//! A line that is valid JSON but a shape we don't model becomes a `Notice`
//! (chrome), not output: dumping machine JSON into the human log was the reason
//! the run panel read as noise. Genuine non-JSON lines stay `RawLine` so
//! nothing a human can read is ever dropped.

use serde::Deserialize;
use terminal_core::models::NoticeLevel;

/// Events emitted by the parser. The supervisor maps these onto
/// `RunnerEvent`s and ultimately onto protocol `AppEvent`s.
#[derive(Debug, Clone, PartialEq)]
pub enum ParseEvent {
    /// Session initialized; carries the model id if provided.
    SessionInit { model: Option<String>, session_id: Option<String> },
    /// Assistant emitted text (may be partial across multiple events).
    AssistantText(String),
    /// A token-level delta from a partial-message stream. Rendered live and
    /// then replaced by the committed `AssistantText` for the same block.
    AssistantDelta(String),
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
    /// A stream event we model as chrome rather than output.
    Notice {
        level: NoticeLevel,
        message: String,
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
    /// `--include-partial-messages`: wraps a raw Anthropic streaming event.
    /// We only consume `content_block_delta` → `text_delta`.
    #[serde(rename = "stream_event")]
    StreamEvent {
        #[serde(default)]
        event: Option<serde_json::Value>,
    },
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
            Err(_) => return vec![classify_unmodelled(trimmed)],
        };

        match wire {
            WireEvent::System { subtype, model, session_id } => {
                if subtype.as_deref() == Some("init") {
                    vec![ParseEvent::SessionInit { model, session_id }]
                } else {
                    // Compaction boundaries and other system chatter are real
                    // state changes worth surfacing — but as chrome, not as a
                    // line in the log.
                    match subtype.as_deref() {
                        Some("compact_boundary") => vec![ParseEvent::Notice {
                            level: NoticeLevel::Info,
                            message: "context compacted".into(),
                        }],
                        Some(other) => vec![ParseEvent::Notice {
                            level: NoticeLevel::Info,
                            message: format!("system: {other}"),
                        }],
                        None => Vec::new(),
                    }
                }
            }
            WireEvent::StreamEvent { event } => {
                let delta = event
                    .as_ref()
                    .filter(|e| e.get("type").and_then(|t| t.as_str()) == Some("content_block_delta"))
                    .and_then(|e| e.get("delta"))
                    .filter(|d| d.get("type").and_then(|t| t.as_str()) == Some("text_delta"))
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if delta.is_empty() {
                    Vec::new()
                } else {
                    vec![ParseEvent::AssistantDelta(delta.to_string())]
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

/// Classify a JSON line the Claude `WireEvent` shapes don't cover.
///
/// A rate-limit rejection is the single most important thing a user can be told
/// about a run that produces no output and then dies, so it gets a purpose-built
/// message. Anything else that is valid JSON becomes a low-key notice naming the
/// event type — the alternative (dumping the object into the log, which is what
/// this used to do) is what made the panel unreadable.
fn classify_unmodelled(line: &str) -> ParseEvent {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
        // Not JSON at all: real text a human wrote or a CLI printed. Keep it.
        return ParseEvent::RawLine(line.to_string());
    };
    match value.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "rate_limit_event" => ParseEvent::Notice {
            level: NoticeLevel::Error,
            message: rate_limit_message(&value),
        },
        "" => ParseEvent::RawLine(line.to_string()),
        other => ParseEvent::Notice {
            level: NoticeLevel::Info,
            message: format!("stream event: {other}"),
        },
    }
}

/// One actionable sentence from Claude's `rate_limit_event`. The window that
/// ran out (`seven_day`, `five_hour`, …) is what tells the user when it clears.
fn rate_limit_message(value: &serde_json::Value) -> String {
    let status = value.get("status").and_then(|v| v.as_str()).unwrap_or("");
    if status == "rejected" || status == "blocked" {
        let window = value
            .get("rateLimitType")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| {
                ["seven_day", "five_hour"]
                    .into_iter()
                    .find(|k| value.get(*k).is_some())
                    .map(str::to_string)
            });
        match window {
            Some(w) => format!("usage limit reached ({w}) — the model refused this run"),
            None => "usage limit reached — the model refused this run".into(),
        }
    } else if status.is_empty() {
        "rate limit update".into()
    } else {
        format!("rate limit: {status}")
    }
}

// --- Hermes `chat --format stream-json` --------------------------------------

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum HermesWireEvent {
    #[serde(rename = "system")]
    System {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(default)]
        model: Option<String>,
        #[serde(default)]
        session_id: Option<String>,
    },
    /// Incremental text: concatenating every `text` event reproduces the answer
    /// byte for byte, which is what makes live streaming possible at all.
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "tool_use")]
    ToolUse {
        name: String,
        #[serde(default)]
        tool_call_id: Option<String>,
        #[serde(default)]
        input: serde_json::Value,
    },
    #[serde(rename = "tool_result")]
    ToolResult {
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        tool_call_id: Option<String>,
        #[serde(default)]
        output: String,
        #[serde(default)]
        is_error: bool,
    },
    #[serde(rename = "result")]
    Result(HermesResultEvent),
}

#[derive(Debug, Deserialize)]
struct HermesResultEvent {
    #[serde(default)]
    exit_code: Option<i32>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    tokens: Option<HermesTokens>,
}

#[derive(Debug, Deserialize)]
struct HermesTokens {
    #[serde(default)]
    input: Option<u64>,
    #[serde(default)]
    output: Option<u64>,
}

/// Parser for the Hermes stream-json dialect. Same `ParseEvent` output as the
/// Claude parser, so the supervisor treats both runners identically.
pub struct HermesStreamParser;

impl HermesStreamParser {
    pub fn new() -> Self {
        Self
    }

    pub fn feed_line(&mut self, line: &str) -> Vec<ParseEvent> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        let wire: HermesWireEvent = match serde_json::from_str(trimmed) {
            Ok(w) => w,
            Err(_) => return vec![classify_unmodelled(trimmed)],
        };

        match wire {
            HermesWireEvent::System { subtype, model, session_id } => {
                if subtype.as_deref() == Some("init") {
                    vec![ParseEvent::SessionInit { model, session_id }]
                } else {
                    Vec::new()
                }
            }
            HermesWireEvent::Text { text } => {
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![ParseEvent::AssistantDelta(text)]
                }
            }
            HermesWireEvent::ToolUse { name, tool_call_id, input } => {
                vec![ParseEvent::ToolUse {
                    // Hermes always sends an id; fall back to the name so a
                    // result can still be matched if it ever doesn't.
                    id: tool_call_id.unwrap_or_else(|| name.clone()),
                    input_preview: tool_input_preview(&name, &input),
                    name,
                }]
            }
            HermesWireEvent::ToolResult { name, tool_call_id, output, is_error } => {
                vec![ParseEvent::ToolResult {
                    tool_use_id: tool_call_id.or(name).unwrap_or_default(),
                    is_error,
                    preview: first_line(&output, 200),
                }]
            }
            HermesWireEvent::Result(r) => {
                let exit_code = r.exit_code.unwrap_or(0);
                let input_tokens = r.tokens.as_ref().and_then(|t| t.input).unwrap_or(0);
                let output_tokens = r.tokens.as_ref().and_then(|t| t.output).unwrap_or(0);
                let success = exit_code == 0 && r.error.is_none();
                let error_text = r.error.or_else(|| {
                    (!success).then(|| format!("hermes exited with code {exit_code}"))
                });

                let mut out = Vec::new();
                // Commit the final text as output. Its deltas already streamed
                // live; committing clears the live buffer in the UI, so the
                // answer is shown once and ends up in the persisted log.
                if let Some(text) = r.text.filter(|t| !t.is_empty()) {
                    out.push(ParseEvent::AssistantText(text));
                }
                out.push(ParseEvent::Result {
                    success,
                    subtype: if success { "success" } else { "error" }.to_string(),
                    num_turns: 1,
                    cost_usd: 0.0,
                    input_tokens,
                    output_tokens,
                    error_text,
                });
                out
            }
        }
    }
}

impl Default for HermesStreamParser {
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
    fn unknown_event_type_becomes_a_notice_not_raw_json() {
        let mut p = StreamParser::new();
        // Valid JSON we don't model must not reach the log verbatim — dumping
        // machine objects into the panel is what made it unreadable.
        let ev = p.feed_line(r#"{"type":"future_event_kind","foo":1}"#);
        assert!(
            matches!(
                ev.as_slice(),
                [ParseEvent::Notice { level: NoticeLevel::Info, message }]
                    if message.contains("future_event_kind")
            ),
            "expected an Info notice, got {ev:?}"
        );
    }

    #[test]
    fn rate_limit_rejection_is_an_actionable_error_notice() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"rate_limit_event","status":"rejected","rateLimitType":"seven_day"}"#,
        );
        assert!(
            matches!(
                ev.as_slice(),
                [ParseEvent::Notice { level: NoticeLevel::Error, message }]
                    if message.contains("usage limit reached") && message.contains("seven_day")
            ),
            "expected an Error notice naming the window, got {ev:?}"
        );
    }

    #[test]
    fn plain_text_lines_are_still_preserved_verbatim() {
        let mut p = StreamParser::new();
        // Not JSON at all: real text. Must never be swallowed by classification.
        let ev = p.feed_line("compiling widget v1.2.3");
        assert!(matches!(ev.as_slice(), [ParseEvent::RawLine(l)] if l == "compiling widget v1.2.3"));
    }

    #[test]
    fn partial_message_stream_event_yields_a_text_delta() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}}"#,
        );
        assert!(matches!(ev.as_slice(), [ParseEvent::AssistantDelta(t)] if t == "Hel"));
    }

    #[test]
    fn non_text_stream_events_are_ignored() {
        let mut p = StreamParser::new();
        let ev = p.feed_line(
            r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}}"#,
        );
        assert!(ev.is_empty(), "expected no events, got {ev:?}");
    }

    // --- Hermes stream-json ---

    #[test]
    fn hermes_parses_init_and_text_deltas() {
        let mut p = HermesStreamParser::new();
        let init = p.feed_line(
            r#"{"type": "system", "subtype": "init", "model": "deepseek-v4.1-flash", "session_id": "20261008_145451_695a4d"}"#,
        );
        assert!(matches!(
            init.as_slice(),
            [ParseEvent::SessionInit { model: Some(m), session_id: Some(s) }]
                if m == "deepseek-v4.1-flash" && s == "20261008_145451_695a4d"
        ));

        // Deltas are fragments and must arrive unsplit, or streaming is pointless.
        let a = p.feed_line(r#"{"type": "text", "text": "O Douro "}"#);
        let b = p.feed_line(r#"{"type": "text", "text": "nasce na Serra"}"#);
        assert!(matches!(a.as_slice(), [ParseEvent::AssistantDelta(t)] if t == "O Douro "));
        assert!(matches!(b.as_slice(), [ParseEvent::AssistantDelta(t)] if t == "nasce na Serra"));
    }

    #[test]
    fn hermes_parses_tool_use_and_result() {
        let mut p = HermesStreamParser::new();
        let use_ev = p.feed_line(
            r#"{"type": "tool_use", "name": "Bash", "tool_call_id": "call_1", "input": {"command": "git status --short"}}"#,
        );
        assert!(matches!(
            use_ev.as_slice(),
            [ParseEvent::ToolUse { id, name, input_preview }]
                if id == "call_1" && name == "Bash" && input_preview == "git status --short"
        ));

        let result_ev = p.feed_line(
            r#"{"type": "tool_result", "name": "Bash", "tool_call_id": "call_1", "output": " M README.md\n", "duration_ms": 12, "is_error": false}"#,
        );
        // `first_line` trims, so the preview is the trimmed first line.
        assert!(matches!(
            result_ev.as_slice(),
            [ParseEvent::ToolResult { tool_use_id, is_error: false, preview }]
                if tool_use_id == "call_1" && preview == "M README.md"
        ));
    }

    #[test]
    fn hermes_result_commits_the_text_and_reports_tokens() {
        let mut p = HermesStreamParser::new();
        let ev = p.feed_line(
            r#"{"type": "result", "session_id": "s", "exit_code": 0, "text": "OK", "tokens": {"input": 135, "output": 3, "total": 22156}, "duration_ms": 2943}"#,
        );
        // The committed text lands in the log; the deltas that streamed it are
        // replaced in the UI, so the answer is shown once.
        assert!(matches!(ev.first(), Some(ParseEvent::AssistantText(t)) if t == "OK"));
        assert!(
            matches!(
                ev.last(),
                Some(ParseEvent::Result { success: true, input_tokens: 135, output_tokens: 3, .. })
            ),
            "expected a successful Result with tokens, got {ev:?}"
        );
    }

    #[test]
    fn hermes_nonzero_exit_is_a_failed_result_with_a_reason() {
        let mut p = HermesStreamParser::new();
        let ev = p.feed_line(r#"{"type": "result", "exit_code": 2, "text": "", "error": "no credentials"}"#);
        assert!(
            matches!(
                ev.last(),
                Some(ParseEvent::Result { success: false, error_text: Some(e), .. })
                    if e == "no credentials"
            ),
            "expected a failed Result carrying the error, got {ev:?}"
        );
    }
}
