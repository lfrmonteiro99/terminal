# Git in Terminal Engine

This document describes the git surface that the daemon exposes and how the
frontend panes use it. For the optional `cc` shell helper (legacy of the old
CLI design), see [`bin-cc.md`](./bin-cc.md).

## Daemon operations

All git operations go through `git_engine.rs` — pure CLI invocations via
`tokio::process::Command`. No libgit2.

| AppCommand | What the daemon does |
|------------|----------------------|
| `GetRepoStatus` | `git status --porcelain=v1`, rev-parse HEAD / branch |
| `GetChangedFiles { mode }` | Status for working tree, or diff for a completed run |
| `GetFileDiff { file_path, mode, run_id? }` | `git diff` scoped to one file |
| `StageFile` / `UnstageFile` | `git add <path>` / `git restore --staged <path>` |
| `CreateCommit { message }` | `git commit -m` on staged changes |
| `ListBranches` / `CheckoutBranch` / `CreateBranch` | Branch navigation |
| `GetCommitHistory { limit }` | `git log --oneline` with author/date metadata |
| `ListStashes` / `GetStashFiles` / `GetStashDiff` | Stash browser |
| `CheckDirtyState` | Uncommitted-changes probe before starting a run |
| `StashAndRun` | `git stash` + `StartRun`, then restore after |
| `PushBranch` / `PullBranch` / `FetchRemote` | Remote ops (M5-03) |
| `GetMergeConflicts` / `ResolveConflict` | 3-way conflict editor (M5-05) |

Each operation replies with a matching `AppEvent` (`RepoStatusResult`,
`ChangedFilesList`, `FileDiffResult`, `CommitCreated`, `BranchList`,
`StashList`, `PushCompleted`, `PullCompleted`, `MergeConflicts`, etc.).
Errors surface as `GitOperationFailed { operation, reason }`.

## Run isolation via worktrees

When the user starts an AI run, the daemon:

1. Checks `CheckDirtyState`. If dirty and the user didn't opt into
   `StashAndRun`, it emits `DirtyWarning` and waits for confirmation.
2. Creates a worktree in `.terminal-worktrees/<run-id>/` from the current
   branch head.
3. Runs Claude inside that worktree (so the user's checkout is untouched).
4. On completion emits `RunCompleted` with a `DiffStat`. The frontend shows a
   **Merge** / **Revert** choice in `PostRunSummary`.

`MergeRun` squashes the run's diff back into the user's branch; `RevertRun`
deletes the worktree. Both paths clean up the worktree meta in
`~/.terminal-daemon/worktrees/`.

## Frontend panes

| Pane | Uses |
|------|------|
| `GitStatusPane` | `RepoStatusResult`, `ChangedFilesList`, stage/unstage, commit box |
| `GitHistoryPane` | `CommitHistoryResult` |
| `MergeConflictPane` | `MergeConflicts`, `ResolveConflict` with 3-way view |
| `StashDrawer` | `StashList`, `StashFiles`, `StashDiff` |
| `DirtyWarningModal` | `DirtyWarning` → `StashAndRun` / `StartRun { skip_dirty_check }` / cancel |
| `CommandPalette` | `BranchList` for quick `CheckoutBranch` |

Toasts for `PushCompleted`, `PullCompleted`, `FetchCompleted`,
`GitOperationFailed` are dispatched from the event router into the workspace
store's `gitToast` slot and shown in `StatusBar`.

## Guardrails

Guardrails are per-operation and enforced in the daemon:

- Dirty-tree check before every run.
- `ResolveConflict` refuses if the file no longer has conflict markers.
- Worktree paths are derived from run UUIDs to avoid collisions.
- `PushBranch` / `PullBranch` default to the current branch + `origin`; the
  frontend never force-pushes.

UI-level guardrails (protected-branch warning, commit-type enforcement,
conventional-commit templates) live in the optional `cc` helper — see
[`bin-cc.md`](./bin-cc.md).

## Testing git flows

```bash
docker compose run --rm test cargo test -p terminal-daemon git_engine
```

The tests spin up ephemeral repos in `tempfile::TempDir` and run the real
`git` binary inside the container.
