# BL-1133 hardener pass — 20260825

**Architect tip:** `f4a6e44063` (merged onto hardender)
**Task:** `BL-1133-babysitterd-heartbeat-start-and-end-of-tick`

## Product surface

`babysitterd.sh`: content-free `pulse_heartbeat` at process start, tick
start, and tick end. Shell — no Stryker/CRAP/DRY (degraded fallback).
Authorize **BL-1133 paths only** (architect: BL-1134 hitchhike in tip
lineage is not this parcel).

## Gates

| Gate | Result |
|------|--------|
| `test_babysitterd_heartbeat_pulses.sh` | ALL PASS (01–06) |
| `bl1133…Invariants.property.test.js` | 4/4 |
| APS `BL-1133-babysitterd-heartbeat-start-and-end-of-tick.feature` | 4/4 |
| Soft Gherkin | `outcome: inapplicable` (no Outline) — not a pass |
| Standing step guards (tmuxReaper / bl968 / bl643) | green |

## Soft Gherkin → surgical (BL-638)

| Mutant | Verdict |
|--------|---------|
| drop-tick-start-pulse | killed |
| drop-tick-end-pulse | killed |
| drop-cold-start-pulse | killed (after test fix) |
| pulse-noop | killed |
| pulse-wrong-token | killed |
| tick-check-only | killed |

`mutants: killed=6 survived=0 skipped=0`

## Hardening fix

Unit 05's cold-start structural check used `grep … pulse_heartbeat | tail -1`
before `while true` — tick()'s pulses also sit above `while`, so deleting
only the top-level cold-start call still passed. Tightened to require a
**top-level** `pulse_heartbeat` outside any function, and added **06**
requiring ≥2 heartbeats before first `CHECK_MARK` on the forever path
(cold + tick-start).

## Forward

`git_handoff` to `documenter`, priority `00`, same task name.
Authorize BL-1133 paths only.

By hardender.
