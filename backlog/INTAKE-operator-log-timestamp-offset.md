# Intake: Operator's self-narrated operator.log timestamps drift ~1 hour off real UTC

Filed by the coordinator (2026-07-17), a defect surfaced while investigating the
Operator response-latency report above (`INTAKE-operator-response-latency.md`) —
distinct root cause, filed separately per that investigation's own finding that
it "doesn't look like the actual cause of the lag" but is a real bug in its own
right.

This is a RAW ask, not a spec: the specifier drains this like any other
backlog-root item and decides what (if anything) becomes a real ticket.

## What was observed

Comparing consecutive `operator.log` entries against the actual system clock at
the moment of inspection:
  - `operator.log` line: `2026-07-17T02:15Z TELEGRAM_TOPIC_MESSAGE (OPERATOR,
    uid 765185321): ... handoffd heartbeat 02:14:34Z fresh ...`
  - Actual system time at the same real moment (`date -u`): `2026-07-17T01:15Z`
  - The immediately preceding logged entry (`2026-07-17T01:01Z
    SWARM_CHECK_TIMER`) uses a timestamp consistent with the real system clock.

So the Operator's own self-narrated timestamp for that one entry — both its
log-line prefix and the "handoffd heartbeat 02:14:34Z" freshness claim inside
its own narrative — reads ~59-60 minutes AHEAD of the real system clock at the
same instant. The magnitude (almost exactly 60 minutes) is consistent with a
local-time value (this host is UTC+1) being labeled with a `Z` (UTC) suffix
somewhere in how the Operator computes or logs "now," rather than a genuine
multi-tick stall — the underlying event-to-reply gaps that ARE independently
verifiable (e.g. the pause-question round trip) were a few real minutes, not an
hour.

## Coordinator findings (context, not a decision)

1. This was a ONE-TIME observation during a single investigation, not
   confirmed as reproducible/systemic — the specifier or whoever picks this up
   should re-check a few more `operator.log` entries against real wall-clock
   time before concluding this is a persistent offset vs. a one-off glitch
   (e.g. tied to the `build_freshness_cli.bb` restart of `operator_runtime.bb`
   that happened earlier in the same session).
2. Regardless of frequency, this is worth fixing because the Operator's own
   "is anything stale?" health-check reasoning (the GREEN/health-sweep lines
   throughout `operator.log`) explicitly COMPARES its own narrated "now"
   against heartbeat/HEAD timestamps to judge freshness — a self-consistent
   but wrong clock could make a genuinely stale signal read as fresh (or vice
   versa), which is exactly the kind of blind spot that turns a real stall
   into a false-GREEN report.

## Ask for the swarm

Specifier: investigate where the Operator computes "now" for its own log
narration/health comparisons (likely inside `operator_runtime.bb` or a prompt
instruction it follows) and whether it's using a local-time value labeled as
UTC, or a genuinely stale/cached time source. Confirm reproducibility across
several ticks before scoping a fix — this may be as small as using the correct
UTC accessor consistently, but should be verified against real code rather
than assumed from this one observation.
