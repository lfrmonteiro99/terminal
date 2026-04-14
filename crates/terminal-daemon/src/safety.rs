use std::path::{Path, PathBuf};
use terminal_core::protocol::v1::AppEvent;
use tokio::sync::broadcast;
use tracing::error;

/// Serialize and broadcast an event. Logs errors instead of panicking.
pub fn broadcast_event(tx: &broadcast::Sender<String>, event: &AppEvent) {
    match serde_json::to_string(event) {
        Ok(json) => {
            let _ = tx.send(json);
        }
        Err(e) => error!(
            "Failed to serialize event {:?}: {}",
            std::mem::discriminant(event),
            e
        ),
    }
}

/// Validate that a requested path stays within the project root.
pub fn validate_path(root: &Path, requested: &Path) -> Result<PathBuf, String> {
    let resolved = if requested.is_absolute() {
        requested.to_path_buf()
    } else {
        root.join(requested)
    };

    let mut normalized = PathBuf::new();
    for component in resolved.components() {
        match component {
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            std::path::Component::CurDir => {}
            c => normalized.push(c),
        }
    }

    if !normalized.starts_with(root) {
        return Err(format!(
            "Path '{}' resolves outside project root '{}'",
            requested.display(),
            root.display()
        ));
    }

    Ok(normalized)
}

/// Validate a git ref name for safety.
pub fn validate_git_ref(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("Git ref name cannot be empty".into());
    }
    if name.starts_with('-') {
        return Err(format!(
            "Git ref '{}' looks like a flag — rejected",
            name
        ));
    }
    let forbidden = [
        ';', '|', '&', '$', '`', '(', ')', '{', '}', '<', '>', '\\', '!', '\n', '\r',
    ];
    for ch in forbidden {
        if name.contains(ch) {
            return Err(format!(
                "Git ref '{}' contains forbidden character '{}'",
                name, ch
            ));
        }
    }
    if name.contains(char::is_whitespace) {
        return Err(format!("Git ref '{}' contains whitespace", name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use terminal_core::protocol::v1::AppEvent;
    use tokio::sync::broadcast;

    // --- broadcast_event tests ---

    #[tokio::test]
    async fn broadcast_event_sends_json() {
        let (tx, mut rx) = broadcast::channel::<String>(8);
        let event = AppEvent::AuthSuccess;
        broadcast_event(&tx, &event);
        let received = rx.try_recv().expect("should have received a message");
        let parsed: serde_json::Value =
            serde_json::from_str(&received).expect("should be valid JSON");
        assert_eq!(parsed["type"], "AuthSuccess");
    }

    #[tokio::test]
    async fn broadcast_event_no_receivers_does_not_panic() {
        let (tx, rx) = broadcast::channel::<String>(8);
        // Drop the receiver so there are no active receivers
        drop(rx);
        let event = AppEvent::AuthSuccess;
        // Must not panic
        broadcast_event(&tx, &event);
    }

    // --- validate_path tests ---

    #[test]
    fn validate_path_inside_root() {
        let root = Path::new("/project");
        let requested = Path::new("src/main.rs");
        let result = validate_path(root, requested).expect("should be OK");
        assert_eq!(result, PathBuf::from("/project/src/main.rs"));
    }

    #[test]
    fn validate_path_traversal_rejected() {
        let root = Path::new("/project");
        let requested = Path::new("../../etc/passwd");
        let err = validate_path(root, requested).expect_err("should be rejected");
        assert!(err.contains("resolves outside project root"));
    }

    #[test]
    fn validate_path_absolute_inside_root() {
        let root = Path::new("/project");
        let requested = Path::new("/project/src/lib.rs");
        let result = validate_path(root, requested).expect("should be OK");
        assert_eq!(result, PathBuf::from("/project/src/lib.rs"));
    }

    #[test]
    fn validate_path_absolute_outside_root() {
        let root = Path::new("/project");
        let requested = Path::new("/etc/passwd");
        let err = validate_path(root, requested).expect_err("should be rejected");
        assert!(err.contains("resolves outside project root"));
    }

    // --- validate_git_ref tests ---

    #[test]
    fn validate_git_ref_normal_branch() {
        assert!(validate_git_ref("feature/my-branch").is_ok());
        assert!(validate_git_ref("main").is_ok());
        assert!(validate_git_ref("v1.0.0").is_ok());
    }

    #[test]
    fn validate_git_ref_rejects_shell_metacharacters() {
        assert!(validate_git_ref("; rm -rf /").is_err());
        assert!(validate_git_ref("branch$(whoami)").is_err());
        assert!(validate_git_ref("branch|evil").is_err());
        assert!(validate_git_ref("branch&evil").is_err());
        assert!(validate_git_ref("branch`cmd`").is_err());
    }

    #[test]
    fn validate_git_ref_rejects_flag_injection() {
        assert!(validate_git_ref("--force").is_err());
        assert!(validate_git_ref("-D").is_err());
    }

    #[test]
    fn validate_git_ref_rejects_empty() {
        assert!(validate_git_ref("").is_err());
    }

    #[test]
    fn validate_git_ref_rejects_whitespace() {
        assert!(validate_git_ref("branch name").is_err());
    }
}
