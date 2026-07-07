# BL-144: Daemon Death Alarm — Understanding the Alert and Recovery

**When the SwarmForge daemon (handoffd) dies, the swarm stops and you receive an alarm email.**

This runbook explains what the alarm means and how to recover.

## What You'll See

You will receive an email with the subject line:
```
SwarmForge: daemon died, swarm halted
```

The email contains:
- A reference to the **failure log** — a file under `.swarmforge/daemon/` that captures why the daemon stopped
- The **recovery command** — a single line to run after you've fixed the daemon

Example email:
```
The handoffd daemon died. No auto-restart was attempted - the swarm has been 
stopped so a human can look at it.

Failure log: /path/to/target/.swarmforge/daemon/daemon_failure_20260707T160000Z.txt
After fixing the daemon, run: swarmforge ensure /path/to/target
```

## What Happened

The daemon (handoffd) is the central process that delivers handoffs between agents and performs liveness sweeps (chase/watchdog). If it dies:

1. **It is not automatically restarted** — this is intentional. A dead daemon is a serious failure that requires investigation.
2. **The swarm stops immediately** — all agent panes are halted so no work continues on a broken substrate.
3. **Queue state is preserved** — all `.swarmforge/handoffs/` files are untouched, so work can resume from where it stopped.
4. **A failure log is written** — diagnostic information is captured so you can understand why the daemon failed.

## Failure Log Contents

The failure log (named `daemon_failure_<timestamp>.txt` under `.swarmforge/daemon/`) contains:

- **Death timestamp** — when the daemon exited
- **Reason** — signal (e.g., `SIGSEGV`) or exit status if captured
- **Restart history** — prior attempts to restart the daemon (if any)
- **Per-role inbox/outbox snapshot** — how many undelivered handoffs were queued at each role when the daemon died
- **Last daemon log lines** — the final 200 lines of the daemon's own stderr/stdout log, often showing the error that caused the crash

Example failure log snippet:
```
SwarmForge daemon failure report
died_at: 2026-07-07T16:00:00Z
reason: signal-11
restart_history: []
last_incident: nil

per-role inbox/outbox snapshot at time of death:
  coder: inbox/new=1 outbox=0
  cleaner: inbox/new=2 outbox=0

last daemon log lines:
  [16:00:00] handoffd: delivering outbox/00_20260707T160000Z_000050...
  [16:00:01] ERROR: segmentation fault in clojure.core/assoc
  ...
```

## Recovery Steps

1. **Read the failure log** — understand what went wrong.
   ```bash
   cat /path/to/target/.swarmforge/daemon/daemon_failure_*.txt
   ```

2. **Fix the underlying issue** — this depends on the failure:
   - If it's a Clojure crash (stack trace in the log), report it; the daemon may have a bug.
   - If it's a file permission issue, fix the target's `.swarmforge/daemon/` permissions.
   - If it's a network issue (Resend API, email delivery), verify the notification service.
   - If the reason is unclear, check the full daemon log:
     ```bash
     tail -200 /path/to/target/.swarmforge/daemon/handoffd.log
     ```

3. **Resume the swarm** — once the issue is fixed, run:
   ```bash
   swarmforge ensure /path/to/target
   ```

   This command:
   - Checks the `.swarmforge/` state
   - Restarts the daemon if it's not running
   - Reattaches all agent panes to the tmux session
   - Resumes work from the preserved queue state

4. **Monitor the restart** — watch the swarm tiles in VS Code to confirm agents resume work. If the daemon dies again immediately, the underlying issue may not be fixed.

## Common Failure Reasons

| Reason | Likely Cause | Fix |
|--------|--------------|-----|
| `signal-9` (SIGKILL) | Process was forcefully killed by system/user | Identify what killed it; may be OOM, user intervention, or container kill |
| `signal-11` (SIGSEGV) | Segmentation fault in Babashka/JVM | Report as a daemon bug; may require a code fix |
| `signal-15` (SIGTERM) | Daemon was terminated cleanly (expected during swarm stop) | Normal; not an error if this is a controlled shutdown |
| File permission error | Cannot write daemon status file or failure log | Fix permissions: `chmod 755 .swarmforge/daemon/` |
| Network error (email) | Resend API or email delivery failed | Check network; verify `swarmforge.notify.email.to` config is set correctly |
| Log write error | Cannot write to daemon log | Check disk space and `.swarmforge/daemon/` permissions |

## Prevention

The daemon is part of SwarmForge's reliability layer. If deaths are frequent:

1. **Check resources** — ensure the target machine has adequate disk space, memory, and file descriptors.
2. **Review logs** — look for patterns in the failure logs to identify a systemic issue.
3. **Report bugs** — if the daemon crashes with a stack trace, report it so it can be fixed.

## See Also

- **BL-146** — Single-daemon consolidation: explains how the daemon owns both delivery and liveness.
- **BL-145** — Swarmforge ensure command: details on `swarmforge ensure` recovery.
- **Daemon Status** — `.swarmforge/daemon/handoffd.status.json` tracks the daemon's health state in real time.
