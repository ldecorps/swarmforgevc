# LIVE handoffd silent-stall, 2026-08-20 ~00:55Z — the exact defect BL-967 fixes

Raised by babysitter ("handoffd.log silent 314s, daemon may be futex-hung: process
alive, ensure dead"). Coordinator investigated. **CONFIRMED, and it is the known
2026-08-05 shape. No restart performed — deliberately.**

## Confirmed
- `handoffd` (pid 38213) alive, **state `U`** (uninterruptible wait), CPU 0.3% — blocked,
  not spinning.
- `handoffd.log` frozen at 00:49:41Z; zero growth over a 4s resample. Silent 334s+ at
  time of check.
- **One** `heartbeat cycle` line in the entire log — the frozen-heartbeat signature from
  the 2026-08-05 outage.
- Last lines before freezing: repeated `chase-wake-skip-busy QA`.

## Cascade preconditions: ABSENT (this is why no action was taken)
The 2026-08-05 outage killed the swarm not from the stall itself but from the cascade:
duplicate supervisors + a hung terminal-app `swarm-cleanup.sh`. Neither exists now —
`pgrep -f handoffd_supervisor` = **1**, no `swarm-cleanup` processes. The safe state is
therefore "degraded, stable", and a restart would ADD risk: the playbook records that a
plain restart does NOT fix this (three fresh daemons re-stalled) while restarting under
a freshness-cron flap is exactly what triggered the teardown.

## Actual impact: degraded auto-routing, NOT a halt
- Delivery still works — `swarm_handoff.sh` writes + injects directly and does not go
  through the daemon; sends and receipts continued throughout.
- Roles are working. QA is at a prompt between turns with **16 background shells**
  running 25-35 minutes (long verification suites), newest 38s old — grinding, not wedged.
- What IS lost: chase/wake, open-slot nudges, stale-claim detection. The risk is a role
  finishing and nothing waking the next one.
- Queue depth behind the bottleneck: QA holds 8 queued (oldest **86m**) + 1 in process;
  architect 2 queued (18m). Article 2.4's 10-minute chase threshold is far exceeded, but
  the cause is a slow final gate plus a dead chaser, not an unrouted parcel.

## Correction to this coordinator's own BL-967 ranking
Earlier today I ranked BL-968 above BL-967, arguing BL-967 was "LOUD and recoverable by
restart; it announces itself". **This incident disproves both halves.** It was silent —
nothing surfaced it but a babysitter sweep against a 300s log-quiet threshold — and the
playbook says a restart does not recover it. The ranking rationale was wrong on the
facts. BL-967 and BL-968 are now judged equally severe: both are silent failures of
machinery the swarm relies on, one in transport and one in the acceptance gate. Order
between them is no longer a blast-radius argument and can follow ordinary priority.

## Standing blocker
BL-967 (defect/high, `human_approval: approved`, priority 20) is the fix for exactly
this, and it cannot promote: active 7 = effective cap 7. Its defect is now LIVE in
production. Capacity is a human decision; surfaced, not acted on.
