# BL-1097 — hardener pass, 2026-08-24

## Inbound

Merged architect `19e4596c1c` (on cleaner `86d11f933d` / coder
`2274b46dd2`) into `swarmforge-hardender`.

## Scope

Router originates no parcel for a ticket that already has a dispatch trail;
`ticket-dispatched?` is `decide-dispatch-gaps` for one ticket. No
`extension/src/**` — Stryker/CRAP/DRY N/A.

Stamp-off tip hygiene: HOTFIX_PATHS `cursor-forge.conf` + `pipelineBoard.ts`
still match `27273f2b0a`.

## Host

Load ~8 on 20 cores (under 2× busy threshold).

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0 errors=0
outcome: "pass"
```

Manifest stamped.

## Hand-authored surgical sweep

First pass had three weak/equivalent survivors (comment-only `exit 3`
replace; bare `contains?` behaviour-equivalent to today's
`decide-dispatch-gaps`; CLI string `dispatched` hit usage text). Closed by
source-wiring asserts in
`bl1097_router_dispatch_trail_test_runner.bb` (16–18) plus precise anchors:

| # | Mutant | Result |
|---|--------|--------|
| M1 | `ticket-dispatched?` always false | killed (unit) |
| M2 | always true | killed (unit) |
| M3 | bare `contains?` rewrite | killed (unit wiring) |
| M4 | drop `:outbox` from trail states | killed (unit) |
| M5 | real refuse `exit 3` → noop | killed (unit wiring) |
| M6 | CLI `"DISPATCHED"` → `"UNDISPATCHED"` | killed (unit wiring) |

Survivors: 0.

## Verification

- Unit ALL PASS; shell 01–07 ALL PASS; property 200 runs ALL PASS
- Acceptance 4/4; whole-tree guards 125/125
- CRAP / DRY / Stryker: N/A

## Findings

NONE (after wiring locks).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked`.

By hardender.
