# BL-1104 — hardener pass, 2026-08-24

## Inbound

Fast-forwarded architect `b10e4a9d85` (on cleaner `a32d1566fc` / coder
`cfe232597f`) into `swarmforge-hardender`.

## Scope

Third active-ticket sweep: subject-anchored QA approval on main, no close,
nudge QA once. Parcel is `.bb` + APS + property — no `extension/src/**`.
Stryker/CRAP/DRY N/A (degraded `.bb` gate).

## Host

Load ~1.6 on 20 cores (quiet).

## Standing whole-tree guards

First pass: `tempDirTrapGuard` RED —
`landed_but_open_test_runner.bb` created a temp dir with `delete-tree` but
not `(try … (finally … delete-tree))` / shutdown hook. Wrapped the fixture
in `try/finally`. Guards then 13/13 (125 tests) green.

## BL-113 Gherkin

Soft first run: **2 survivors** — Outline 03 ticket cells `BL-2003→BL-20x3`
and `BL-2004→BLx2004` (self-consistent label swaps). Locked
`EXPECTED_SIBLING_ROWS` in the step Then that names owner+ticket.
Hard re-run: **total=6 killed=6 survived=0**, outcome pass; manifest
stamped.

## Hand-authored surgical sweep

| # | Mutant | Result |
|---|--------|--------|
| M1 | decide ignore closed-ids | killed (unit) |
| M2 | decide ignore nudged-ids | killed (unit) |
| M3 | draft `to: coordinator` | killed (unit) |
| M4 | qa-approval-signal always true | killed (unit) |
| M5–M6 | close/boundary anchors | skip |
| M7 | remove handoffd `run-sweep! "landed-but-open"` | **survived** then **killed** after wiring assert |

M7 gap (BL-419): acceptance uses the harness. Added unit asserts that
`handoffd.bb` contains `run-sweep! "landed-but-open"` and defines
`landed-but-open-sweep!`.

## Verification

- Unit OK; acceptance 7/7; properties 3/3; guards 125/125
- CRAP / DRY / Stryker: N/A

## Findings

NONE (after Outline lock + temp-trap + wiring fixes).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1104-qa-landed-ticket-never-closed-strands-in-active`.

By hardender.
