# BL-275 QA bounce — 2026-07-11

## 1. Failing command

```
claude --append-system-prompt-file swarmforge/roles/support.prompt --print "hello"
```

Run from the repo root (`/home/carillon/swarmforgevc/.worktrees/QA`) — this is
the exact `--append-system-prompt-file` invocation `launch_support.sh` builds
(`PROMPT="$ROOT/swarmforge/roles/support.prompt"`, line 29, then passed
verbatim into `CLAUDE_CMD` at line 49).

## 2. Commit hash

`0c4064eebd` (documenter's handoff, merged into QA at the current QA-branch
HEAD after `git merge 0c4064eebd`).

## 3. First error excerpt

```
Error: Append system prompt file not found: /home/carillon/swarmforgevc/.worktrees/QA/swarmforge/roles/support.prompt
EXIT: 1
```

`swarmforge/roles/support.prompt` does not exist anywhere in git history on
any branch (`git log --all --oneline --diff-filter=A -- '**/support.prompt'`
returns nothing).

## 4. Failure class

`behavior` — an intent/wiring mismatch, not a compile or unit-test failure.
The full unit suite and all 4 acceptance scenarios pass; the gap is invisible
to both because nothing exercises the real (non-dry-run) launch path.
`test_support_runtime_tick.sh`'s launcher check (line 57) only asserts the
dry-run command STRING contains the substring `roles/support.prompt` — it
never asserts the path resolves to a real file.

## 5. Expected vs observed

**Expected:** per BL-275's own ticket description ("Role prompt: the
specifier lands `swarmforge/roles/support.prompt` ... WITH this slice's
integration"), the file should exist so a real Support launch succeeds and
the QA e2e procedure ("open a discussion over an RC session") can actually
run.

**Observed:** `swarmforge/roles/support.prompt` is missing entirely.
`launch_support.sh` hard-references it via `--append-system-prompt-file`,
and the `claude` CLI exits 1 immediately when that path doesn't resolve —
so every real (non-dry-run) Support launch fails before the disposable LLM
ever starts. The Support MVP is not actually reachable today despite every
test passing.
