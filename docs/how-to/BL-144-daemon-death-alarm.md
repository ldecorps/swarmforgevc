# BL-144: Daemon Death Alarm — Understanding the Alert and Recovery

**When the SwarmForge daemon (handoffd) dies, the supervisor first tries a
bounded in-place restart (BL-1492); only once that restart budget is spent
does it fall back to BL-144's original full halt.** Either way you receive
an alarm email.

This runbook explains what the alarm means and how to recover.

## The restart-then-halt ladder (BL-1492)

On a `:dead`/`:stalled` verdict, `handoffd_supervisor.bb` no longer halts
the swarm on the first sighting:

1. **Restart budget has headroom** (default: fewer than 2 restarts recorded
   in the last 600s of `restart_history`): the daemon is restarted in place
   through the one start owner, `start_handoff_daemon.sh` (BL-690) — no role
   session or tmux server is touched. The alarm email still sends (subject
   `SwarmForge: handoffd <verdict>, restarted in place (<outcome>)`), the
   failure log is still written, and the restart is appended to
   `restart_history` in the status file.
2. **Budget exhausted**: the unchanged BL-144 halt below — same failure
   log, same "swarm halted" email, same `halt-swarm!`, same `halted`
   status.

The budget re-arms itself once a restart's `restart_history` entry ages
past the window (default 600s) with no further death in that window —
there is no separate healthy-uptime timer to track. Tune the budget with
`SUPERVISOR_RESTART_BUDGET_COUNT` and `SUPERVISOR_RESTART_BUDGET_WINDOW_MS`.

The rest of this runbook (failure log contents, recovery steps) applies
to both the restart and the halt outcome; where they differ is called out
below.

## What You'll See — the halt (budget exhausted, or the pre-BL-1492 case)

You will receive an email with the subject line:
```
SwarmForge: daemon died, swarm halted
```

The email contains:
- A reference to the **failure log** — a file under `.swarmforge/daemon/` that captures why the daemon stopped
- As of BL-813, the failure log itself **attached** to the email — an
  off-box operator can read the crash directly without SSH-ing into the
  target machine. Attaching is best-effort: if building the attachment fails
  (e.g. an oversized or unencodable log), the email still sends with the
  path-only body and the halt still proceeds — a broken attachment never
  blocks BL-144's alarm-and-halt.
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

1. **It is restarted in place first, within a bounded budget (BL-1492)** —
   the first (and, by default, second) death within a 600s window is
   handled by restarting handoffd through the one start owner; no
   investigation is required to keep the swarm moving. Only once the
   budget is spent within the window does the supervisor treat it as a
   serious failure requiring investigation and fall back to the full halt
   below.
2. **The swarm stops immediately on a halt** — all agent panes are halted so no work continues on a broken substrate.
3. **Queue state is preserved** — all `.swarmforge/handoffs/` files are untouched, so work can resume from where it stopped.
4. **A failure log is written** — diagnostic information is captured so you can understand why the daemon failed.
5. **As of BL-1491, the halt records itself on both death-detector ledgers**,
   write-ahead — before the first role session is killed, not after:
   - A row is appended to `.swarmforge/daemon/kill-all-audit.log`, the same
     `<iso> <text>` shape a deliberate `kill_pipeline_swarm.sh` stop already
     writes: `<iso> handoffd_supervisor alarm-and-halt verdict=<reason>`.
   - A `stop` record of class `swarm-stop`, source `handoffd_supervisor`, is
     appended to the availability ledger
     (`.swarmforge/telemetry/availability-YYYY-MM.jsonl`, BL-823) via the same
     `availability_record` writer a deliberate stop uses.

   Both writes are best-effort: if a write fails (e.g. an unwritable
   telemetry directory), the halt still proceeds — a broken record never
   blocks the alarm-and-halt. Before BL-1491, an alarm-and-halt left neither
   record, so the operator's death-detector signals (audit log, availability
   fold) read a halted swarm as clean; only a grep of `handoffd-supervisor.log`
   proved it happened. Both rows are now written before either signal check
   would run, so an interrupted halt still leaves its trace.

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

   As of BL-690, ensure's daemon repair runs `start_handoff_daemon.sh` — the
   same daemon-start owner the launch paths already use — never
   `handoffd_supervisor.bb --check-once`, the health probe that can itself
   `alarm-and-halt!` and re-stop a swarm ensure just brought back up.

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
- **BL-690** — Fixed ensure's daemon repair to start the daemon instead of running the halt-authority probe; see the note under Recovery Steps above.
- **BL-813** — Attached the failure log to the death email (see above) and hardened `ambulance_lib.bb`'s `ticket-has-file?` against the active→done glob-then-vanish race that caused this incident's crash.
- **BL-1491** — Made every alarm-and-halt write a kill-all-audit row and an availability stop record write-ahead (see above), so the death is visible on both ledgers instead of only in a log grep.
- **BL-1492** — Put a bounded in-place restart ahead of the halt (see "The restart-then-halt ladder" above): most deaths no longer take the swarm down at all, and the halt remains BL-144's unchanged escalation once the restart budget is spent.
- **Daemon Status** — `.swarmforge/daemon/handoffd.status.json` tracks the daemon's health state in real time.
