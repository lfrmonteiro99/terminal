// Search engine — grep across project files (TERMINAL-006)

use std::path::Path;
use std::time::Instant;
use terminal_core::models::SearchMatch;
use terminal_core::protocol::v1::AppEvent;
use tokio::process::Command;

/// Search for `query` across files under `root` using grep.
///
/// Falls back gracefully: `rg` if available, otherwise `grep -rn`.
#[allow(clippy::too_many_arguments)]
pub async fn search_files(
    root: &Path,
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    include_glob: Option<&str>,
    exclude_glob: Option<&str>,
    max_results: usize,
    context_lines: usize,
) -> Result<AppEvent, Box<dyn std::error::Error + Send + Sync>> {
    let start = Instant::now();

    // Prefer ripgrep; fall back to grep
    let rg_available = Command::new("rg")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    let output = if rg_available {
        run_ripgrep(
            root,
            query,
            is_regex,
            case_sensitive,
            include_glob,
            exclude_glob,
            context_lines,
        )
        .await?
    } else {
        run_grep(
            root,
            query,
            is_regex,
            case_sensitive,
            include_glob,
            exclude_glob,
            context_lines,
        )
        .await?
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    let (matches, total_matches, files_searched, truncated) =
        parse_grep_output(&output, max_results);

    Ok(AppEvent::SearchResults {
        query: query.to_string(),
        matches,
        total_matches,
        files_searched,
        truncated,
        duration_ms,
    })
}

async fn run_ripgrep(
    root: &Path,
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    include_glob: Option<&str>,
    exclude_glob: Option<&str>,
    context_lines: usize,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut cmd = Command::new("rg");
    cmd.arg("--line-number");
    cmd.arg("--no-heading");
    cmd.arg("--with-filename");
    cmd.arg("--color=never");

    if !case_sensitive {
        cmd.arg("--ignore-case");
    }
    if !is_regex {
        cmd.arg("--fixed-strings");
    }
    if context_lines > 0 {
        cmd.arg(format!("-C{}", context_lines));
    }
    if let Some(g) = include_glob {
        cmd.arg("--glob").arg(g);
    }
    if let Some(g) = exclude_glob {
        cmd.arg("--glob").arg(format!("!{}", g));
    }

    // Always exclude common noise dirs
    cmd.arg("--glob").arg("!node_modules/**");
    cmd.arg("--glob").arg("!.git/**");
    cmd.arg("--glob").arg("!target/**");

    cmd.arg("--").arg(query);
    cmd.current_dir(root);

    let out = cmd.output().await?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

async fn run_grep(
    root: &Path,
    query: &str,
    is_regex: bool,
    case_sensitive: bool,
    include_glob: Option<&str>,
    exclude_glob: Option<&str>,
    context_lines: usize,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut cmd = Command::new("grep");
    cmd.arg("-rn");

    if !case_sensitive {
        cmd.arg("-i");
    }
    if !is_regex {
        cmd.arg("-F");
    }
    if context_lines > 0 {
        cmd.arg(format!("-C{}", context_lines));
    }
    if let Some(g) = include_glob {
        cmd.arg("--include").arg(g);
    }
    if let Some(g) = exclude_glob {
        cmd.arg("--exclude-dir").arg(g);
    }

    // Exclude common noise dirs
    cmd.arg("--exclude-dir=node_modules");
    cmd.arg("--exclude-dir=.git");
    cmd.arg("--exclude-dir=target");

    cmd.arg(query).arg(".");
    cmd.current_dir(root);

    let out = cmd.output().await?;
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Parse `grep -n` / `rg` output into `SearchMatch` structs.
///
/// Both tools emit lines in one of three formats when using `-C N`:
///   - `file:line:text`   — a match line
///   - `file-line-text`   — a context line
///   - `--`               — group separator
///
/// We group context lines with the match that follows them.
fn parse_grep_output(raw: &str, max_results: usize) -> (Vec<SearchMatch>, usize, usize, bool) {
    // pending_context accumulates lines that precede the next match
    let mut pending_context: Vec<String> = Vec::new();
    // partial_match holds a match we have emitted but may still receive "after" context for
    let mut matches: Vec<SearchMatch> = Vec::new();
    let mut total_matches = 0usize;
    let mut seen_files: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in raw.lines() {
        if line == "--" {
            // Group separator — flush pending context, clear state
            pending_context.clear();
            continue;
        }

        // Try to split as a match line: `file:line:text`
        if let Some(m) = try_parse_match_line(line) {
            total_matches += 1;
            seen_files.insert(m.file_path.to_string_lossy().into_owned());

            if matches.len() < max_results {
                matches.push(SearchMatch {
                    file_path: m.file_path,
                    line_number: m.line_number,
                    line_content: m.line_content,
                    context_before: std::mem::take(&mut pending_context),
                    context_after: Vec::new(),
                });
            } else {
                pending_context.clear();
            }
            continue;
        }

        // Otherwise treat as context line: `file-line-text`
        if let Some(ctx_text) = try_parse_context_line(line) {
            if let Some(last) = matches.last_mut() {
                // If we already have a match with no "after" context yet and no pending context,
                // this is an "after" context line for the previous match.
                if pending_context.is_empty() {
                    last.context_after.push(ctx_text);
                    continue;
                }
            }
            pending_context.push(ctx_text);
        }
    }

    let files_searched = seen_files.len();
    let truncated = matches.len() < total_matches;
    (matches, total_matches, files_searched, truncated)
}

struct RawMatch {
    file_path: std::path::PathBuf,
    line_number: usize,
    line_content: String,
}

/// Try to parse `file:lineno:text` (colon-separated match line).
fn try_parse_match_line(line: &str) -> Option<RawMatch> {
    // Split on first colon to get filename
    let (file, rest) = split_once_colon(line)?;
    // Split rest on first colon to get line number
    let (line_no_str, text) = split_once_colon(rest)?;
    let line_number = line_no_str.trim().parse::<usize>().ok()?;
    Some(RawMatch {
        file_path: std::path::PathBuf::from(file),
        line_number,
        line_content: text.to_string(),
    })
}

/// Try to parse `file-lineno-text` (hyphen-separated context line).
fn try_parse_context_line(line: &str) -> Option<String> {
    // Context lines use `-` as separator: `filename-line-text`
    // Just return the text portion
    let (_file, rest) = split_once_hyphen(line)?;
    let (_line_no, text) = split_once_hyphen(rest)?;
    Some(text.to_string())
}

fn split_once_colon(s: &str) -> Option<(&str, &str)> {
    let pos = s.find(':')?;
    Some((&s[..pos], &s[pos + 1..]))
}

fn split_once_hyphen(s: &str) -> Option<(&str, &str)> {
    let pos = s.find('-')?;
    Some((&s[..pos], &s[pos + 1..]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_simple_match() {
        let raw = "src/main.rs:5:fn main() {\n";
        let (matches, total, files, truncated) = parse_grep_output(raw, 500);
        assert_eq!(total, 1);
        assert_eq!(files, 1);
        assert!(!truncated);
        assert_eq!(matches[0].line_number, 5);
        assert_eq!(matches[0].line_content, "fn main() {");
    }

    #[test]
    fn parse_truncated_at_max() {
        let raw: String = (1..=10)
            .map(|i| format!("src/lib.rs:{}:line {}\n", i, i))
            .collect();
        let (matches, total, _files, truncated) = parse_grep_output(&raw, 5);
        assert_eq!(total, 10);
        assert_eq!(matches.len(), 5);
        assert!(truncated);
    }

    #[test]
    fn search_match_serialization_roundtrip() {
        let m = SearchMatch {
            file_path: std::path::PathBuf::from("src/main.rs"),
            line_number: 42,
            line_content: "fn main() {}".to_string(),
            context_before: vec!["// comment".to_string()],
            context_after: vec!["}".to_string()],
        };
        let json = serde_json::to_string(&m).unwrap();
        let de: SearchMatch = serde_json::from_str(&json).unwrap();
        assert_eq!(de.line_number, 42);
        assert_eq!(de.context_before.len(), 1);
        assert_eq!(de.context_after.len(), 1);
    }
}
