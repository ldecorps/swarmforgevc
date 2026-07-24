# BL-349: Stuck-Role Escalation Email — Understanding the Alert

**When a SwarmForge agent (coder, cleaner, architect, etc.) gets stuck without responding or making progress, you receive an email alert.**

This runbook explains what triggers the alarm and what to do when you receive it.

## What You'll See

You will receive an email with the subject line:
```
SwarmForge: role <ROLE> stuck, needs intervention
```

The email contains:
- The **role name** that stopped responding (e.g., `coder`, `architect`, `hardener`)
- The **ticket id** the role was working on when it got stuck
- A **reference to the escalation log** — a file under `.swarmforge/daemon/` with timing details
- The **recommended recovery action** — usually to respawn the stuck role

Example email:
```
The coder role has not responded for 60 seconds while working on BL-528.
No progress has been detected.

Escalation log: /path/to/target/.swarmforge/daemon/chase-escalations.json
Recommended action: respawn the coder role via swarmforge ensure /path/to/target
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
4. **The ticket is noted** — the escalation log records which ticket the role was holding when it got stuck.

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

The escalation log (`.swarmforge/daemon/chase-escalations.json`) records:

```json
{
  "escalations": [
    {
      "role": "coder",
      "escalated_at": "2026-07-24T14:30:00Z",
      "idle_seconds": 92,
      "ticket_id": "BL-528",
      "status": "email-sent",
      "reason": "no-progress-past-threshold"
    }
  ]
}
```

This tells you:
- **role** — which role got stuck
- **escalated_at** — exactly when the alarm fired
- **idle_seconds** — how long the role had been idle before escalation
- **ticket_id** — what work the role was holding
- **status** — `email-sent` means the email was delivered successfully
- **reason** — why the role was flagged (always `no-progress-past-threshold` for now)

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
