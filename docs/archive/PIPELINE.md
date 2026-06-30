# Three-Pack Parcel Flow

Four agents: **coordinator** (orchestrates, no worktree) + three pipeline roles on the target.

## Notify chain

```
specifier ──► coder ──► tester ──► everybody
```

| Role | Worktree | Model | Notifies |
|------|----------|-------|----------|
| **coordinator** | master (no code) | Opus | *(orchestrates only)* |
| **specifier** | master | Sonnet | **coder** |
| **coder** | `coder` worktree | Sonnet | **tester** — declares job done |
| **tester** | `tester` worktree | Haiku | **everybody** |

## Worktrees

- **Specifier** works on **master** (integration branch / boss).
- **Coder** and **tester** each have their own git worktree under `.worktrees/`.
- **Coordinator** never commits to the target.

## Coder declares job done

When implementation is complete:

1. Run unit tests. Stop if any fail.
2. Commit on the coder worktree branch.
3. **SEND: `git_handoff` to tester** (priority 00) with commit SHA and an explicit **job done** message.

The parcel moves to tester; coder does not notify specifier or coordinator directly.

## Tester completion (notify everybody)

When verification passes:

1. **SEND: `git_handoff` to specifier** (priority 00) — item verified.
2. **SEND: `note` to coordinator,coder** (priority 00) — QA complete broadcast.

## Coordinator

- Not in the forward notify chain.
- Receives tester's broadcast; notifies the user and tracks PR readiness.

See `swarmforge/handoff-protocol.md` for file format.
