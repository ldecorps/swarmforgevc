# Handoff dual-path delivery (tmux primary, mailbox backup)

## Can agents pass messages via tmux injection?

**Yes — but not by typing into tmux themselves.** Agents call `swarm_handoff.sh`
with a validated draft. The substrate delivers:

1. **Parcel** — atomic write to sender `outbox/`, copy to each recipient
   `inbox/new/`.
2. **Tmux wake** — verified `send-keys` of the generic string:
   `You have new handoff mail. If idle, run ready_for_next.sh.`
3. **Agent pickup** — recipient runs `ready_for_next.sh` → `TASK:` / `BATCH:` /
   `NO_TASK`.

Agents must never call `tmux send-keys` directly (constitution + role prompts).

## Two paths, one mailbox

| Path | When | What happens |
|------|------|----------------|
| **Primary — sync tmux inject** | Every `swarm_handoff.sh` call | Try immediate delivery + wake. On success, move outbox → `sent/`. |
| **Backup — daemon mailbox** | `SWARMFORGE_SKIP_DAEMON` unset and sync inject failed | `handoffd` polls `outbox/`, copies to `inbox/new/`, retries tmux wake, moves to `sent/`. |

Happy path (sync inject succeeds): outbox is already in `sent/` before the daemon
polls — **daemon work is a no-op**. Mailbox files are the audit trail, not
something the agent needs to discuss.

Phase 1 (`SWARMFORGE_SKIP_DAEMON=1`): only the primary path runs; sync failure
is a hard error (no backup).

## Mailbox-only exercise (`SWARMFORGE_MAILBOX_ONLY=1`)

Inverse of phase 1 — **files only, no tmux wake anywhere**:

| Step | Behavior |
|------|----------|
| `swarm_handoff.sh` | Writes outbox only (`skip-sync-inject`); does not call `notify!`. |
| `handoffd` | Polls outbox → copies to `inbox/new/` → logs `delivered-mailbox-only` (no `send-keys`). |
| Agent pickup | **Must** run `ready_for_next.sh` (idle poll, human nudge, or chase without wake). |

Launch:

```bash
SWARMFORGE_TERMINAL=none SWARMFORGE_MAILBOX_ONLY=1 ./swarm . --pack two-pack
```

Send a test note:

```bash
./swarmforge/scripts/mailbox_note_to_role.sh cleaner "mailbox probe"
```

F5 config: **Run Extension (mailbox-only)** in `.vscode/launch.json` (no `SKIP_DAEMON`).

## Pane narration — mail is silent unless novel

**Default (happy path):** After a tmux wake, the agent runs `ready_for_next.sh`
and works the task. It must **not** narrate mailbox transport, daemon, or email
delivery — the handoff *content* (task, note, commit) is what matters.

**Backup-only discovery:** If the agent was **not** woken by tmux (missed inject,
wedged pane, daemon-only delivery) and `ready_for_next.sh` returns a `TASK:`
for a parcel it has not yet processed, it may briefly note that mail arrived via
the mailbox backup before proceeding. Example: *"Picked up handoff from inbox
that was not preceded by a wake — processing now."*

**Human email (BL-073):** Resend notifications for *needs-human* are orthogonal.
They must never be read aloud or summarized in agent panes unless the human
explicitly asks. Agents ignore operator email alerts silently during normal work.

## Operator tools

```bash
# Send a test note (sync inject, phase 1)
SWARMFORGE_SKIP_DAEMON=1 ./swarmforge/scripts/inject_note_to_role.sh QA "probe"

# Watch injection outcomes
./swarmforge/scripts/inject_traffic.sh -n 20 --follow
```

## Phase mapping (BL-153)

- **BL-154 (done):** Primary path only; `inject-traffic.log` + `inject_traffic.sh`.
- **BL-155 (done):** Daemon backup when sync inject fails; default launch starts handoffd.
