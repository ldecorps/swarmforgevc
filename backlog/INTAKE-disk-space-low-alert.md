# Intake: alert the human via Telegram when disk space is dangerously low

Filed 2026-07-15 (human-requested via Claude Code session, priority: high).
RAW intake — specifier drains and decides what becomes a real ticket.

## Why (incident, 2026-07-14/15 overnight)

The human reports last night's swarm breakdown was caused by **no space
left on device** (ENOSPC). A full disk takes down everything at once and
in the worst way: agents crash mid-write, handoff parcels / topic records /
concierge state get truncated or lost, git operations fail, and the swarm
cannot even write the logs that would explain what happened. It is also
exactly the failure mode the swarm cannot self-heal from.

## Desired behavior

Proactive early warning, before the cliff:

- A cheap periodic check (the operator runtime tick or its own small loop —
  reuse an existing always-alive loop rather than adding a new daemon) of
  free space on the filesystem(s) the swarm writes to: the project root's
  mount and /tmp if distinct.
- Thresholds with hysteresis, e.g. WARN at <10% (or <5 GB) free, CRITICAL
  at <5% (or <2 GB). Announce transitions only (the BL-394 change-gate
  lesson: never re-announce an unchanged state every tick; record an
  emittedKey / last-state and alert again only on level change or after a
  long re-arm window).
- Deliver via the existing human channel: a Telegram message through the
  front desk / operator notify path (operator_notify.bb or the event
  stream), including the mount, free bytes/percent, and the top few space
  consumers if cheap to compute (du of .swarmforge/, worktrees, /tmp).
- CRITICAL could additionally pause new work intake (optional, separate
  slice) — but the alert alone is the ask.

## Notes

- Check df on the real swarm root (/home/carillon/swarmforgevc), not the
  Windows mount.
- Known large growers to mention in the alert as hints: .swarmforge/ logs
  (front-desk-supervisor.log reached ~2 MB/day), tmp acceptance sandboxes
  (/tmp/sfvc-*, /tmp/aps-role-lifecycle-*), .worktrees/, node_modules.
- A companion cleanup ticket (log rotation for .swarmforge/*.log, sweeping
  stale /tmp sandboxes) may fall out of this — specifier's call whether it
  is the same ticket or a second one.

## Measurement update (2026-07-15T10:05Z, post-incident)

Current df: WSL root (/) = 1007G, 6% used, 907G free — HEALTHY. But
/mnt/c (Windows C:) = 390G, **79% used, only 83G free**.

This strongly suggests the actual ENOSPC mechanism: the WSL2 filesystem is
a dynamically-growing VHDX stored ON C:. When C: itself fills, writes
inside WSL fail with ENOSPC even though df inside WSL still reports
hundreds of GB free. So the alert MUST monitor BOTH:

  1. df of the swarm root's own filesystem inside WSL, AND
  2. df of /mnt/c (the Windows host volume backing the VHDX)

with C: likely the one that actually matters. Thresholds for C: should be
absolute (e.g. WARN <40G free, CRITICAL <15G) since the VHDX can grow in
large increments.
