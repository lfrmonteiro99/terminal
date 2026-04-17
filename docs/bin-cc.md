# `bin/cc` — optional git helper

`bin/cc` is a small shell script (~150 lines) with opinionated wrappers around
common branch / commit / PR flows. **It is separate from the Terminal Engine
app** — the app does not invoke it, and you can use the app without it.

If you're looking for the shipping product, see
[`architecture.md`](./architecture.md). This page only documents the helper
script.

## Install

No install step — it's a script in the repo:

```bash
./bin/cc --help
```

Optionally put it on your `PATH`:

```bash
ln -s "$(pwd)/bin/cc" ~/.local/bin/cc
```

## Commands

```text
cc doctor
cc branch start <ticket-slug>
cc review
cc sync
cc commit [type] [message...]
cc pr
```

### `cc doctor`

Prints the current branch, ahead/behind counts vs `origin/<default-branch>`,
working-tree status, and whether `gh` is installed.

### `cc branch start <slug>`

1. Refuses to run if the tree isn't clean.
2. `git fetch --all --prune`.
3. Checks out the default branch and fast-forwards it.
4. Creates `feature/<slug>`.

### `cc review`

Local pre-PR review: lists changed files, `git diff --stat`, and the last five
commits. Pure informational — nothing is modified.

### `cc sync`

`git fetch origin` + `git rebase origin/<default-branch>`. Stops on conflict —
resolve manually, then `git rebase --continue`.

### `cc commit [type] [message…]`

`git add -A` + `git commit -m "<type>: <message>"`. `<type>` must be one of
`feat|fix|chore|refactor|docs|test|perf`. Defaults to `chore: update files`.

### `cc pr`

Requires the GitHub CLI (`gh`). Runs `gh pr create --fill` with a minimal
template. Title defaults to `<branch>: update`.

## Configuration

One environment variable:

| Variable | Default | Purpose |
|----------|---------|---------|
| `CC_DEFAULT_BRANCH` | `main` | Branch name used by `cc doctor` / `cc branch start` / `cc sync` |

There is no config file. (Earlier design sketches mentioned
`.cc-terminal.yml`; that file was never implemented and has been removed from
the docs — configure with `CC_DEFAULT_BRANCH` instead.)

## Guardrails

- Every command rejects running outside a git worktree.
- `cc branch start` and `cc sync` refuse on a dirty tree.
- `cc commit` enforces a conventional-commit prefix.
- Nothing force-pushes; no `reset --hard`.

## Relation to the app

The Terminal Engine daemon exposes equivalent git operations via the
WebSocket protocol (`StageFile`, `CreateCommit`, `PushBranch`, …) —
see [`git-flow.md`](./git-flow.md). If you're already in the app, you don't
need `cc`. The helper exists for terminal-only workflows and for users who
want a scripted pre-commit flow outside the GUI.
