#![allow(dead_code)] // Public API — consumers added in later tasks

use std::fs;
use std::path::{Path, PathBuf};
use terminal_core::models::{
    FailPhase, Run, RunState, Session, TerminalSessionMeta, WorktreeMeta,
};
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Not found: {0}")]
    NotFound(String),
}

type Result<T> = std::result::Result<T, PersistenceError>;

#[derive(Debug, Default)]
pub struct RecoveryReport {
    pub orphaned_runs: usize,
    pub orphaned_worktrees: usize,
    pub cleaned_metadata: usize,
}

pub struct Persistence {
    base_dir: PathBuf,
}

impl Persistence {
    /// Creates a new Persistence instance, ensuring the required subdirectories exist.
    pub fn new(base_dir: PathBuf) -> Result<Self> {
        fs::create_dir_all(base_dir.join("sessions"))?;
        fs::create_dir_all(base_dir.join("runs"))?;
        fs::create_dir_all(base_dir.join("worktrees"))?;
        fs::create_dir_all(base_dir.join("terminals"))?;
        Ok(Self { base_dir })
    }

    // -----------------------------------------------------------------------
    // Atomic write helper
    // -----------------------------------------------------------------------

    fn atomic_write(path: &Path, data: &[u8]) -> Result<()> {
        let tmp_path = path.with_extension("json.tmp");
        fs::write(&tmp_path, data)?;
        fs::rename(&tmp_path, path)?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Sessions
    // -----------------------------------------------------------------------

    pub fn save_session(&self, session: &Session) -> Result<()> {
        let path = self.base_dir.join("sessions").join(format!("{}.json", session.id));
        let data = serde_json::to_string_pretty(session)?;
        Self::atomic_write(&path, data.as_bytes())
    }

    pub fn load_session(&self, id: Uuid) -> Result<Session> {
        let path = self.base_dir.join("sessions").join(format!("{}.json", id));
        if !path.exists() {
            return Err(PersistenceError::NotFound(format!("Session {}", id)));
        }
        let data = fs::read_to_string(&path)?;
        let session: Session = serde_json::from_str(&data)?;
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let dir = self.base_dir.join("sessions");
        let mut sessions = Vec::new();

        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(&path).and_then(|data| {
                serde_json::from_str::<Session>(&data)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            }) {
                Ok(session) => sessions.push(session),
                Err(e) => {
                    warn!("Failed to parse session file {:?}: {}", path, e);
                }
            }
        }

        sessions.sort_by_key(|s| s.started_at);
        Ok(sessions)
    }

    pub fn delete_session(&self, id: Uuid) -> Result<()> {
        let path = self.base_dir.join("sessions").join(format!("{}.json", id));
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Runs
    // -----------------------------------------------------------------------

    pub fn save_run(&self, run: &Run) -> Result<()> {
        let path = self.base_dir.join("runs").join(format!("{}.json", run.id));
        let data = serde_json::to_string_pretty(run)?;
        Self::atomic_write(&path, data.as_bytes())
    }

    pub fn load_run(&self, id: Uuid) -> Result<Run> {
        let path = self.base_dir.join("runs").join(format!("{}.json", id));
        if !path.exists() {
            return Err(PersistenceError::NotFound(format!("Run {}", id)));
        }
        let data = fs::read_to_string(&path)?;
        let run: Run = serde_json::from_str(&data)?;
        Ok(run)
    }

    pub fn list_runs_for_session(&self, session_id: Uuid) -> Result<Vec<Run>> {
        let dir = self.base_dir.join("runs");
        let mut runs = Vec::new();

        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(&path).and_then(|data| {
                serde_json::from_str::<Run>(&data)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            }) {
                Ok(run) if run.session_id == session_id => runs.push(run),
                Ok(_) => {}
                Err(e) => {
                    warn!("Failed to parse run file {:?}: {}", path, e);
                }
            }
        }

        runs.sort_by_key(|r| r.started_at);
        Ok(runs)
    }

    // -----------------------------------------------------------------------
    // Worktree metadata
    // -----------------------------------------------------------------------

    pub fn save_worktree_meta(&self, run_id: Uuid, meta: &WorktreeMeta) -> Result<()> {
        let path = self.base_dir.join("worktrees").join(format!("{}.json", run_id));
        let data = serde_json::to_string_pretty(meta)?;
        Self::atomic_write(&path, data.as_bytes())
    }

    pub fn load_worktree_meta(&self, run_id: Uuid) -> Result<WorktreeMeta> {
        let path = self.base_dir.join("worktrees").join(format!("{}.json", run_id));
        if !path.exists() {
            return Err(PersistenceError::NotFound(format!(
                "WorktreeMeta for run {}",
                run_id
            )));
        }
        let data = fs::read_to_string(&path)?;
        let meta: WorktreeMeta = serde_json::from_str(&data)?;
        Ok(meta)
    }

    pub fn delete_worktree_meta(&self, run_id: Uuid) -> Result<()> {
        let path = self.base_dir.join("worktrees").join(format!("{}.json", run_id));
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    pub fn list_worktree_metas(&self) -> Result<Vec<(Uuid, WorktreeMeta)>> {
        let dir = self.base_dir.join("worktrees");
        let mut metas = Vec::new();

        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let run_id = match path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            {
                Some(id) => id,
                None => {
                    warn!("Invalid worktree meta filename: {:?}", path);
                    continue;
                }
            };

            match fs::read_to_string(&path).and_then(|data| {
                serde_json::from_str::<WorktreeMeta>(&data)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            }) {
                Ok(meta) => metas.push((run_id, meta)),
                Err(e) => {
                    warn!("Failed to parse worktree meta {:?}: {}", path, e);
                }
            }
        }

        Ok(metas)
    }

    // -----------------------------------------------------------------------
    // Recovery
    // -----------------------------------------------------------------------

    /// Scans persisted state and cleans up after a daemon crash.
    ///
    /// - Non-terminal runs are marked as Failed { phase: Cleanup }.
    /// - Orphaned worktree metadata (where the run is terminal) is deleted.
    pub fn recover(&self) -> Result<RecoveryReport> {
        let mut report = RecoveryReport::default();
        let runs_dir = self.base_dir.join("runs");

        // Pass 1: mark non-terminal runs as Failed
        for entry in fs::read_dir(&runs_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let data = match fs::read_to_string(&path) {
                Ok(d) => d,
                Err(e) => {
                    warn!("Failed to read run file {:?}: {}", path, e);
                    continue;
                }
            };

            let mut run: Run = match serde_json::from_str(&data) {
                Ok(r) => r,
                Err(e) => {
                    warn!("Failed to parse run file {:?}: {}", path, e);
                    continue;
                }
            };

            if run.state.is_active() {
                info!(
                    "Recovery: marking run {} as Failed (was {:?})",
                    run.id, run.state
                );
                run.state = RunState::Failed {
                    error: "Daemon crashed during run".into(),
                    phase: FailPhase::Cleanup,
                };
                run.ended_at = Some(chrono::Utc::now());
                run.last_modified = chrono::Utc::now();

                let updated = serde_json::to_string_pretty(&run)?;
                Self::atomic_write(&path, updated.as_bytes())?;
                report.orphaned_runs += 1;
            }
        }

        // Pass 2: clean orphaned worktree metadata
        let worktrees_dir = self.base_dir.join("worktrees");
        for entry in fs::read_dir(&worktrees_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }

            let run_id = match path
                .file_stem()
                .and_then(|s| s.to_str())
                .and_then(|s| Uuid::parse_str(s).ok())
            {
                Some(id) => id,
                None => continue,
            };

            match self.load_run(run_id) {
                Ok(run) if run.state.is_terminal() => {
                    // TODO: call git_engine::worktree_remove for actual worktree cleanup
                    warn!(
                        "Recovery: removing orphaned worktree metadata for terminal run {}",
                        run_id
                    );
                    fs::remove_file(&path)?;
                    report.orphaned_worktrees += 1;
                    report.cleaned_metadata += 1;
                }
                Ok(_) => {
                    // Run is still active (shouldn't happen after pass 1, but be defensive)
                }
                Err(PersistenceError::NotFound(_)) => {
                    warn!(
                        "Recovery: removing worktree metadata for missing run {}",
                        run_id
                    );
                    fs::remove_file(&path)?;
                    report.orphaned_worktrees += 1;
                    report.cleaned_metadata += 1;
                }
                Err(e) => {
                    warn!(
                        "Recovery: failed to load run {} for worktree check: {}",
                        run_id, e
                    );
                }
            }
        }

        info!(
            "Recovery complete: {} orphaned runs, {} orphaned worktrees, {} cleaned metadata files",
            report.orphaned_runs, report.orphaned_worktrees, report.cleaned_metadata
        );

        Ok(report)
    }

    // -----------------------------------------------------------------------
    // Terminal Session Persistence (M4-06)
    // -----------------------------------------------------------------------

    pub fn save_terminal_meta(&self, meta: &TerminalSessionMeta) -> Result<()> {
        let path = self
            .base_dir
            .join("terminals")
            .join(format!("{}.json", meta.session_id));
        let data = serde_json::to_string_pretty(meta)?;
        Self::atomic_write(&path, data.as_bytes())
    }

    pub fn load_terminal_meta(&self, session_id: Uuid) -> Result<TerminalSessionMeta> {
        let path = self
            .base_dir
            .join("terminals")
            .join(format!("{}.json", session_id));
        if !path.exists() {
            return Err(PersistenceError::NotFound(format!(
                "Terminal session {}",
                session_id
            )));
        }
        let data = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&data)?)
    }

    pub fn list_terminal_metas(&self) -> Result<Vec<TerminalSessionMeta>> {
        let dir = self.base_dir.join("terminals");
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut metas = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            match fs::read_to_string(&path).and_then(|data| {
                serde_json::from_str::<TerminalSessionMeta>(&data)
                    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
            }) {
                Ok(meta) => metas.push(meta),
                Err(e) => warn!("Failed to parse terminal meta {:?}: {}", path, e),
            }
        }
        Ok(metas)
    }

    pub fn delete_terminal_meta(&self, session_id: Uuid) -> Result<()> {
        let path = self
            .base_dir
            .join("terminals")
            .join(format!("{}.json", session_id));
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    /// Remove terminal metas older than `max_age_hours` hours.
    pub fn cleanup_stale_terminal_metas(&self, max_age_hours: i64) -> Result<usize> {
        let dir = self.base_dir.join("terminals");
        if !dir.exists() {
            return Ok(0);
        }
        let cutoff =
            chrono::Utc::now() - chrono::Duration::hours(max_age_hours);
        let mut cleaned = 0;
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(meta) = serde_json::from_str::<TerminalSessionMeta>(&data) {
                    if meta.last_active_at < cutoff {
                        fs::remove_file(&path)?;
                        cleaned += 1;
                    }
                }
            }
        }
        Ok(cleaned)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use std::path::PathBuf;
    use tempfile::tempdir;
    use terminal_core::models::RunMode;

    fn make_session() -> Session {
        Session {
            id: Uuid::new_v4(),
            project_root: PathBuf::from("/tmp/project"),
            initial_head: "abc123".into(),
            active_run: None,
            runs: vec![],
            commands: vec![],
            started_at: Utc::now(),
            ended_at: None,
            last_modified: Utc::now(),
        }
    }

    fn make_run(session_id: Uuid, state: RunState) -> Run {
        Run {
            id: Uuid::new_v4(),
            session_id,
            branch: "llm/test".into(),
            mode: RunMode::Free,
            state,
            prompt: "do something".into(),
            provided_files: vec![],
            modified_files: vec![],
            expanded_files: vec![],
            output_path: PathBuf::from("/tmp/output.jsonl"),
            output_line_count: 0,
            output_byte_count: 0,
            started_at: Utc::now(),
            ended_at: None,
            last_modified: Utc::now(),
        }
    }

    fn make_worktree_meta() -> WorktreeMeta {
        WorktreeMeta {
            worktree_path: PathBuf::from("/tmp/wt"),
            branch_name: "llm/test".into(),
            base_head: "abc123".into(),
            merge_base: "abc123".into(),
            last_modified: Utc::now(),
        }
    }

    #[test]
    fn test_session_save_load() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session = make_session();
        p.save_session(&session).unwrap();

        let loaded = p.load_session(session.id).unwrap();
        assert_eq!(loaded.id, session.id);
        assert_eq!(loaded.project_root, session.project_root);
        assert_eq!(loaded.initial_head, session.initial_head);
        assert_eq!(loaded.active_run, session.active_run);
        assert_eq!(loaded.runs, session.runs);
        assert_eq!(loaded.started_at, session.started_at);
        assert_eq!(loaded.ended_at, session.ended_at);
    }

    #[test]
    fn test_session_list() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let s1 = make_session();
        let s2 = make_session();
        p.save_session(&s1).unwrap();
        p.save_session(&s2).unwrap();

        let sessions = p.list_sessions().unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_session_delete() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session = make_session();
        p.save_session(&session).unwrap();
        p.delete_session(session.id).unwrap();

        let result = p.load_session(session.id);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PersistenceError::NotFound(_)));
    }

    #[test]
    fn test_run_save_load() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session_id = Uuid::new_v4();
        let run = make_run(session_id, RunState::Running);
        p.save_run(&run).unwrap();

        let loaded = p.load_run(run.id).unwrap();
        assert_eq!(loaded.id, run.id);
        assert_eq!(loaded.session_id, run.session_id);
        assert_eq!(loaded.branch, run.branch);
        assert_eq!(loaded.prompt, run.prompt);
        assert_eq!(loaded.state, RunState::Running);
        assert_eq!(loaded.started_at, run.started_at);
    }

    #[test]
    fn test_runs_for_session() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session_a = Uuid::new_v4();
        let session_b = Uuid::new_v4();

        let r1 = make_run(session_a, RunState::Running);
        let r2 = make_run(session_a, RunState::Completed { exit_code: 0 });
        let r3 = make_run(session_b, RunState::Running);

        p.save_run(&r1).unwrap();
        p.save_run(&r2).unwrap();
        p.save_run(&r3).unwrap();

        let runs_a = p.list_runs_for_session(session_a).unwrap();
        assert_eq!(runs_a.len(), 2);

        let runs_b = p.list_runs_for_session(session_b).unwrap();
        assert_eq!(runs_b.len(), 1);
    }

    #[test]
    fn test_worktree_meta_lifecycle() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let run_id = Uuid::new_v4();
        let meta = make_worktree_meta();

        // Save and load
        p.save_worktree_meta(run_id, &meta).unwrap();
        let loaded = p.load_worktree_meta(run_id).unwrap();
        assert_eq!(loaded.branch_name, meta.branch_name);
        assert_eq!(loaded.worktree_path, meta.worktree_path);

        // List
        let metas = p.list_worktree_metas().unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].0, run_id);

        // Delete
        p.delete_worktree_meta(run_id).unwrap();
        let result = p.load_worktree_meta(run_id);
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), PersistenceError::NotFound(_)));
    }

    #[test]
    fn test_load_nonexistent_returns_error() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let missing_id = Uuid::new_v4();

        let session_err = p.load_session(missing_id);
        assert!(matches!(
            session_err.unwrap_err(),
            PersistenceError::NotFound(_)
        ));

        let run_err = p.load_run(missing_id);
        assert!(matches!(
            run_err.unwrap_err(),
            PersistenceError::NotFound(_)
        ));

        let meta_err = p.load_worktree_meta(missing_id);
        assert!(matches!(
            meta_err.unwrap_err(),
            PersistenceError::NotFound(_)
        ));
    }

    #[test]
    fn test_atomic_write_creates_no_tmp_files() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session = make_session();
        p.save_session(&session).unwrap();

        let sessions_dir = dir.path().join("sessions");
        for entry in fs::read_dir(&sessions_dir).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            assert!(
                !name_str.ends_with(".tmp"),
                "Found leftover tmp file: {}",
                name_str
            );
        }
    }

    #[test]
    fn test_recovery_marks_active_runs_failed() {
        let dir = tempdir().unwrap();
        let p = Persistence::new(dir.path().to_path_buf()).unwrap();

        let session_id = Uuid::new_v4();

        // A running (active) run
        let running = make_run(session_id, RunState::Running);
        let running_id = running.id;
        p.save_run(&running).unwrap();

        // A completed (terminal) run
        let completed = make_run(session_id, RunState::Completed { exit_code: 0 });
        let completed_id = completed.id;
        p.save_run(&completed).unwrap();

        let report = p.recover().unwrap();
        assert_eq!(report.orphaned_runs, 1);

        // Running run should now be Failed
        let recovered_run = p.load_run(running_id).unwrap();
        assert_eq!(
            recovered_run.state,
            RunState::Failed {
                error: "Daemon crashed during run".into(),
                phase: FailPhase::Cleanup,
            }
        );
        assert!(recovered_run.ended_at.is_some());

        // Completed run should be unchanged
        let unchanged_run = p.load_run(completed_id).unwrap();
        assert_eq!(unchanged_run.state, RunState::Completed { exit_code: 0 });
    }
}
