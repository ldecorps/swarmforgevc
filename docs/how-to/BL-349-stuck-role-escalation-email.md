# BL-349: Stuck-Role Escalation Email — Understanding the Alert

**When a SwarmForge agent (coder, cleaner, architect, etc.) gets stuck without responding or making progress, you receive an email alert.**

This runbook explains what triggers the alarm and what to do when you receive it.

## What You'll See

You will receive an email with the subject line:
```
SwarmForge: <role> is stuck and needs attention
```

For example: `SwarmForge: coder is stuck and needs attention`.

The email body is fixed text about that one role — it does **not** carry a
ticket id, an escalation-log path, or a recommended command; the sender only
ever passes the role name in:

```
The role "coder" has been stuck (holding an in-process task with no forward progress) past its escalation threshold.

This is unattended - nobody has been notified until this email. Check the role's pane/log and, if needed, respawn or intervene by hand.

This clears on its own once the role becomes unstuck; a NEW stuck episode after recovery will email again.
```

## What Happened

The SwarmForge daemon (handoffd) monitors the heartbeat of every agent role. It tracks:
- Whether the role is running
- The last time the role sent/received a message
- How long the role has been idle without completing work

If a role is idle **past an escalation threshold** (currently 60 seconds):

1. **A timer starts** — the daemon notes the role as potentially stuck.
2. **Progress is checked** — if the role hasn't advanced the parcel (no commits, no handoff) in that time, it's genuinely stuck, not just slow.
3. **An email is sent** — the escalation alarm fires, notifying you that human intervention may be needed.
4. **The role is recorded as escalated** — `chase-escalations.json` marks that role `true` until it recovers (see below); the email itself carries no ticket id.

Unlike the daemon-death alarm, the stuck-role alarm does **not automatically halt the swarm** — the other roles keep working. But the stuck role is now unresponsive and the parcel it holds is stalled.

## Why This Matters

Stuck roles are a sign of one of these conditions:

- **Hung process** — The role's Claude process is frozen, waiting on I/O, or in a bad state.
- **Network issue** — The role can't reach its LLM provider or internal services.
- **Resource exhaustion** — The role ran out of memory or disk space.
- **Infinite loop** — The role is in a code path that repeats forever (rare, but caught by mutation testing).
- **Waiting on input** — The role has a question pending and is blocking until answered (expected, not alarming).

The threshold is conservative (60 seconds for the default pack) to avoid false alarms on slow work, but a stuck role left unaddressed will eventually trigger a broader failure.

## Escalation Log Contents

The escalation log (`.swarmforge/daemon/chase-escalations.json`) is a flat
role-name-to-`true` map of roles **currently** escalated — nothing more:

```json
{ "coder": true }
```

A role with no entry (or an empty `{}` file) is not currently escalated. There
is no array, no timestamp, no ticket id, and no per-escalation record: the
entry for a role is removed entirely once that role recovers, so a later
re-escalation starts fresh.

The delivery/retry state for the email itself (whether it has already been
sent for the current escalation, and backoff bookkeeping if a send attempt
fails) lives in a **separate** file,
`.swarmforge/daemon/chase-escalation-email-state.json` — not in
`chase-escalations.json`.

## Recovery Steps

### If the role recovers on its own

Sometimes a role is slow but not actually hung. If it receives a nudge from the daemon or the work progresses naturally, the escalation is logged but no action is needed.

**Check the parcel status:**
```bash
git log --oneline -n 20 -- .swarmforge/handoffs/
```

If the role has already forwarded the parcel to the next stage, the alarm was benign — it was just slower than the threshold. Log it for trend analysis but no action needed.

### If the role is truly stuck

1. **Respawn the role** — kill and restart just that role's pane, without stopping the whole swarm:
   ```bash
   swarmforge ensure /path/to/target
   ```
   
   This command:
   - Verifies the `.swarmforge/` state
   - Reconnects to the existing tmux session
   - Respawns any stuck role panes
   - Resumes work from the preserved queue state

2. **If the same role gets stuck repeatedly** — there's a deeper issue:
   - Check the role's tmux pane log for error messages (look at the VS Code tile or tmux directly)
   - Check host resources: `free -h` (memory), `df -h` (disk), `top` (CPU)
   - Verify network connectivity to the LLM provider
   - Check `.swarmforge/daemon/handoffd.log` for delivery errors related to that role

3. **If `ensure` doesn't fix it** — the role may have crashed:
   - Kill the swarm entirely: `swarmforge kill /path/to/target`
   - Check the failure log for hints: `cat .swarmforge/daemon/daemon_failure_*.txt`
   - Fix the underlying issue, then restart: `swarmforge /path/to/target` (or use the extension to launch again)

## About the Threshold

**The 60-second threshold is currently hardcoded** in `swarmforge/scripts/handoffd.bb` (line 46, `stuckInProcessTimeoutSeconds`). Tuning via `swarmforge.conf` is not yet supported.

To modify the threshold:
1. Edit `swarmforge/scripts/handoffd.bb` and change `:stuckInProcessTimeoutSeconds 60` to your desired value (in seconds).
2. Restart the swarm for the change to take effect.

Making the threshold configurable is a planned improvement (tracked separately) but not yet implemented.

## See Also

- **BL-144** — Daemon Death Alarm: explains the daemon-death email, which is a different (more critical) alarm
- **Heartbeat & Watchdog** — Section of the Specification describing how the daemon monitors agent health
- **Agent Respawn** — How to manually restart a stuck agent without stopping the whole swarm
