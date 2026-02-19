#![allow(dead_code)] // Public API — consumers added in later tasks

use std::path::{Path, PathBuf};
use terminal_core::models::*;
use tokio::process::Command;
use tracing::debug;

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("git command failed: {0}")]
    CommandFailed(String),
    #[error("git not found or not executable")]
    GitNotFound,
    #[error("not a git repository: {0}")]
    NotARepo(PathBuf),
    #[error("parse error: {0}")]
    ParseError(String),
}

type Result<T> = std::result::Result<T, GitError>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async fn run_git(cwd: &Path, args: &[&str]) -> Result<String> {
    debug!("git {}", args.join(" "));
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(|_| GitError::GitNotFound)?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(GitError::CommandFailed(stderr))
    }
}

// ---------------------------------------------------------------------------
// Query operations
// ---------------------------------------------------------------------------

pub async fn is_git_repo(cwd: &Path) -> bool {
    run_git(cwd, &["rev-parse", "--is-inside-work-tree"])
        .await
        .map(|v| v == "true")
        .unwrap_or(false)
}

pub async fn head_oid(cwd: &Path) -> Result<String> {
    run_git(cwd, &["rev-parse", "HEAD"]).await
}

pub async fn current_branch(cwd: &Path) -> Result<Option<String>> {
    match run_git(cwd, &["symbolic-ref", "--short", "HEAD"]).await {
        Ok(name) => Ok(Some(name)),
        Err(GitError::CommandFailed(_)) => Ok(None), // detached HEAD
        Err(e) => Err(e),
    }
}

pub async fn repo_state(cwd: &Path) -> Result<RepoState> {
    let git_dir_output = run_git(cwd, &["rev-parse", "--git-dir"]).await?;
    let git_dir = if Path::new(&git_dir_output).is_absolute() {
        PathBuf::from(&git_dir_output)
    } else {
        cwd.join(&git_dir_output)
    };

    if git_dir.join("MERGE_HEAD").exists() {
        return Ok(RepoState::Merge);
    }
    if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
        return Ok(RepoState::Rebase);
    }
    if git_dir.join("CHERRY_PICK_HEAD").exists() {
        return Ok(RepoState::Other("cherry-pick".into()));
    }
    if git_dir.join("REVERT_HEAD").exists() {
        return Ok(RepoState::Other("revert".into()));
    }
    if git_dir.join("BISECT_LOG").exists() {
        return Ok(RepoState::Other("bisect".into()));
    }
    Ok(RepoState::Clean)
}

pub async fn guard_repo_state(cwd: &Path) -> Result<()> {
    let state = repo_state(cwd).await?;
    if state != RepoState::Clean {
        return Err(GitError::CommandFailed(format!(
            "repository is not in a clean state: {:?}",
            state
        )));
    }
    Ok(())
}

pub async fn branch_exists(cwd: &Path, name: &str) -> Result<bool> {
    let output = run_git(cwd, &["branch", "--list", name]).await?;
    Ok(!output.is_empty())
}

pub async fn merge_base(cwd: &Path, a: &str, b: &str) -> Result<String> {
    run_git(cwd, &["merge-base", a, b]).await
}

pub async fn changed_files(cwd: &Path, base: &str, head: &str) -> Result<Vec<FileChange>> {
    let range = format!("{}..{}", base, head);
    let output = run_git(cwd, &["diff", "--name-status", &range]).await?;
    if output.is_empty() {
        return Ok(vec![]);
    }

    let mut changes = Vec::new();
    for line in output.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() < 2 {
            continue;
        }
        let status_code = parts[0];
        let path = PathBuf::from(parts[1]);

        let status = if status_code.starts_with('R') {
            let new_path = if parts.len() >= 3 {
                PathBuf::from(parts[2])
            } else {
                path.clone()
            };
            FileStatus::Renamed(new_path)
        } else {
            match status_code {
                "A" => FileStatus::Added,
                "M" => FileStatus::Modified,
                "D" => FileStatus::Deleted,
                _ => FileStatus::Modified, // C, T, U, X, B etc → treat as Modified
            }
        };

        changes.push(FileChange { path, status });
    }
    Ok(changes)
}

pub async fn diff_stat(cwd: &Path, base: &str, head: &str) -> Result<DiffStat> {
    let range = format!("{}..{}", base, head);
    let output = run_git(cwd, &["diff", "--numstat", &range]).await?;

    let mut file_stats = Vec::new();
    let mut total_insertions: usize = 0;
    let mut total_deletions: usize = 0;

    if !output.is_empty() {
        for line in output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 3 {
                continue;
            }
            // Binary files show "-" for insertions/deletions
            let insertions = parts[0].parse::<usize>().unwrap_or(0);
            let deletions = parts[1].parse::<usize>().unwrap_or(0);
            let path = PathBuf::from(parts[2]);

            total_insertions += insertions;
            total_deletions += deletions;

            file_stats.push(FileDiffStat {
                path,
                insertions,
                deletions,
            });
        }
    }

    Ok(DiffStat {
        files_changed: file_stats.len(),
        insertions: total_insertions,
        deletions: total_deletions,
        file_stats,
    })
}

pub async fn diff_full(cwd: &Path, base: &str, head: &str) -> Result<String> {
    let range = format!("{}..{}", base, head);
    run_git(cwd, &["diff", &range]).await
}

// ---------------------------------------------------------------------------
// Mutation operations
// ---------------------------------------------------------------------------

pub async fn worktree_add(cwd: &Path, path: &Path, branch: &str) -> Result<()> {
    let path_str = path.to_string_lossy();
    run_git(cwd, &["worktree", "add", &path_str, "-b", branch]).await?;
    Ok(())
}

pub async fn worktree_remove(cwd: &Path, path: &Path) -> Result<()> {
    let path_str = path.to_string_lossy();
    run_git(cwd, &["worktree", "remove", &path_str, "--force"]).await?;
    Ok(())
}

pub async fn worktree_list(cwd: &Path) -> Result<Vec<PathBuf>> {
    let output = run_git(cwd, &["worktree", "list", "--porcelain"]).await?;
    let mut paths = Vec::new();
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            paths.push(PathBuf::from(path));
        }
    }
    Ok(paths)
}

pub async fn branch_delete(cwd: &Path, name: &str, force: bool) -> Result<()> {
    let flag = if force { "-D" } else { "-d" };
    run_git(cwd, &["branch", flag, name]).await?;
    Ok(())
}

pub async fn merge_branch(cwd: &Path, branch: &str) -> Result<MergeResult> {
    match run_git(cwd, &["merge", "--no-edit", branch]).await {
        Ok(stdout) => {
            if stdout.contains("Fast-forward") {
                Ok(MergeResult::FastForward)
            } else {
                Ok(MergeResult::Merged)
            }
        }
        Err(GitError::CommandFailed(_)) => {
            // Check if we have merge conflicts
            let conflict_output =
                run_git(cwd, &["diff", "--name-only", "--diff-filter=U"]).await;
            match conflict_output {
                Ok(files) if !files.is_empty() => {
                    let paths = files.lines().map(PathBuf::from).collect();
                    Ok(MergeResult::Conflict(paths))
                }
                _ => Err(GitError::CommandFailed(
                    "merge failed but no conflicts detected".to_string(),
                )),
            }
        }
        Err(e) => Err(e),
    }
}

pub async fn merge_abort(cwd: &Path) -> Result<()> {
    run_git(cwd, &["merge", "--abort"]).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::tempdir;

    /// Create a temp dir with `git init`, basic config, and an initial commit.
    fn init_test_repo() -> tempfile::TempDir {
        let dir = tempdir().expect("create tempdir");
        let p = dir.path();

        StdCommand::new("git")
            .args(["init"])
            .current_dir(p)
            .output()
            .expect("git init");

        StdCommand::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(p)
            .output()
            .expect("git config email");

        StdCommand::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(p)
            .output()
            .expect("git config name");

        std::fs::write(p.join("README.md"), "# Test\n").expect("write README");

        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(p)
            .output()
            .expect("git add");

        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(p)
            .output()
            .expect("git commit");

        dir
    }

    // --- Query tests ---

    #[tokio::test]
    async fn test_is_git_repo() {
        let repo = init_test_repo();
        assert!(is_git_repo(repo.path()).await);

        let non_repo = tempdir().expect("create tempdir");
        assert!(!is_git_repo(non_repo.path()).await);
    }

    #[tokio::test]
    async fn test_head_oid() {
        let repo = init_test_repo();
        let oid = head_oid(repo.path()).await.expect("head_oid");
        assert_eq!(oid.len(), 40, "SHA should be 40 hex chars, got: {}", oid);
        assert!(
            oid.chars().all(|c| c.is_ascii_hexdigit()),
            "SHA should be hex: {}",
            oid
        );
    }

    #[tokio::test]
    async fn test_repo_state_clean() {
        let repo = init_test_repo();
        let state = repo_state(repo.path()).await.expect("repo_state");
        assert_eq!(state, RepoState::Clean);
    }

    #[tokio::test]
    async fn test_guard_repo_state_clean() {
        let repo = init_test_repo();
        guard_repo_state(repo.path()).await.expect("guard should succeed on clean repo");
    }

    #[tokio::test]
    async fn test_branch_exists() {
        let repo = init_test_repo();
        // Default branch (could be main or master depending on git config)
        let branch = current_branch(repo.path())
            .await
            .expect("current_branch")
            .expect("should have a branch");
        assert!(
            branch_exists(repo.path(), &branch)
                .await
                .expect("branch_exists")
        );
        assert!(
            !branch_exists(repo.path(), "nonexistent")
                .await
                .expect("branch_exists")
        );
    }

    #[tokio::test]
    async fn test_changed_files() {
        let repo = init_test_repo();
        let base = head_oid(repo.path()).await.expect("head_oid");

        // Add a new file and commit
        std::fs::write(repo.path().join("new.txt"), "hello\n").expect("write file");
        StdCommand::new("git")
            .args(["add", "new.txt"])
            .current_dir(repo.path())
            .output()
            .expect("git add");
        StdCommand::new("git")
            .args(["commit", "-m", "add new.txt"])
            .current_dir(repo.path())
            .output()
            .expect("git commit");

        let head = head_oid(repo.path()).await.expect("head_oid");
        let changes = changed_files(repo.path(), &base, &head)
            .await
            .expect("changed_files");

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, PathBuf::from("new.txt"));
        assert_eq!(changes[0].status, FileStatus::Added);
    }

    #[tokio::test]
    async fn test_diff_stat() {
        let repo = init_test_repo();
        let base = head_oid(repo.path()).await.expect("head_oid");

        // Add a file with 3 lines
        std::fs::write(repo.path().join("lines.txt"), "one\ntwo\nthree\n").expect("write file");
        StdCommand::new("git")
            .args(["add", "lines.txt"])
            .current_dir(repo.path())
            .output()
            .expect("git add");
        StdCommand::new("git")
            .args(["commit", "-m", "add lines.txt"])
            .current_dir(repo.path())
            .output()
            .expect("git commit");

        let head = head_oid(repo.path()).await.expect("head_oid");
        let stat = diff_stat(repo.path(), &base, &head)
            .await
            .expect("diff_stat");

        assert_eq!(stat.files_changed, 1);
        assert_eq!(stat.insertions, 3);
        assert_eq!(stat.deletions, 0);
    }

    // --- Mutation tests ---

    #[tokio::test]
    async fn test_worktree_lifecycle() {
        let repo = init_test_repo();
        let wt_path = repo.path().join("wt-test");
        let branch_name = "test-branch";

        // Create worktree
        worktree_add(repo.path(), &wt_path, branch_name)
            .await
            .expect("worktree_add");
        assert!(wt_path.exists(), "worktree directory should exist");

        // Verify it appears in worktree list
        let trees = worktree_list(repo.path()).await.expect("worktree_list");
        assert!(
            trees.len() >= 2,
            "should have at least main + new worktree, got: {:?}",
            trees
        );

        // Remove worktree
        worktree_remove(repo.path(), &wt_path)
            .await
            .expect("worktree_remove");

        // Branch should still exist after removing worktree
        assert!(
            branch_exists(repo.path(), branch_name)
                .await
                .expect("branch_exists")
        );

        // Delete branch
        branch_delete(repo.path(), branch_name, false)
            .await
            .expect("branch_delete");
        assert!(
            !branch_exists(repo.path(), branch_name)
                .await
                .expect("branch_exists")
        );
    }

    #[tokio::test]
    async fn test_worktree_changes_independent() {
        let repo = init_test_repo();
        let wt_path = repo.path().join("wt-independent");
        let branch_name = "independent-branch";

        worktree_add(repo.path(), &wt_path, branch_name)
            .await
            .expect("worktree_add");

        let base = head_oid(&wt_path).await.expect("head_oid in worktree");

        // Commit a file in the worktree
        std::fs::write(wt_path.join("wt-only.txt"), "worktree content\n").expect("write file");
        StdCommand::new("git")
            .args(["add", "wt-only.txt"])
            .current_dir(&wt_path)
            .output()
            .expect("git add in worktree");
        StdCommand::new("git")
            .args(["commit", "-m", "add wt-only.txt"])
            .current_dir(&wt_path)
            .output()
            .expect("git commit in worktree");

        // Main repo should NOT have this file
        assert!(
            !repo.path().join("wt-only.txt").exists(),
            "main repo should not have worktree file"
        );

        // changed_files should show the new file
        let wt_head = head_oid(&wt_path).await.expect("head_oid worktree");
        let changes = changed_files(&wt_path, &base, &wt_head)
            .await
            .expect("changed_files");

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].path, PathBuf::from("wt-only.txt"));
        assert_eq!(changes[0].status, FileStatus::Added);

        // Cleanup
        worktree_remove(repo.path(), &wt_path)
            .await
            .expect("worktree_remove");
        branch_delete(repo.path(), branch_name, true)
            .await
            .expect("branch_delete");
    }

    #[tokio::test]
    async fn test_merge_fast_forward() {
        let repo = init_test_repo();
        let wt_path = repo.path().join("wt-merge");
        let branch_name = "merge-branch";

        worktree_add(repo.path(), &wt_path, branch_name)
            .await
            .expect("worktree_add");

        // Commit a file in the worktree
        std::fs::write(wt_path.join("merged.txt"), "merge content\n").expect("write file");
        StdCommand::new("git")
            .args(["add", "merged.txt"])
            .current_dir(&wt_path)
            .output()
            .expect("git add");
        StdCommand::new("git")
            .args(["commit", "-m", "add merged.txt"])
            .current_dir(&wt_path)
            .output()
            .expect("git commit");

        // Remove worktree before merging (can't merge into a checked-out branch)
        worktree_remove(repo.path(), &wt_path)
            .await
            .expect("worktree_remove");

        // Merge into main
        let result = merge_branch(repo.path(), branch_name)
            .await
            .expect("merge_branch");
        assert_eq!(result, MergeResult::FastForward);

        // File should now exist in main
        assert!(
            repo.path().join("merged.txt").exists(),
            "merged file should exist in main"
        );

        // Cleanup
        branch_delete(repo.path(), branch_name, true)
            .await
            .expect("branch_delete");
    }
}
