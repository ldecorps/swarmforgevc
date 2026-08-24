# BL-1104 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `cfe232597f` (landed-but-open sweep: detect QA-landed
active tickets and nudge QA to re-notify) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry: `git merge-base --is-ancestor cfe232597f HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/landed_but_open_test_runner.bb`:
   OK.
2. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1104-qa-landed-ticket-never-closed-strands-in-active.feature`:
   7/7 pass.
3. **Wiring** — `handoffd.bb` calls `run-sweep! "landed-but-open"` (required_wiring
   literal present).

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb` — degraded gate is the unit suite.

## Cleanup performed

- Extracted `subject-names-ticket?` and routed `index-qa-approvals` /
  `index-closed-tickets` through `qa-approval-subject?` /
  `close-subject?` so the predicates are the single decision path (not
  test-only duplicates of inline checks).
- Switched `resolve-landed-main-ref` / `read-ref-subject-commits` from raw
  `babashka.process/sh` to `daemon-cycle-guard-lib/sh!` (BL-967 bounded
  waits; same result-map shape) and dropped the now-unused process require.

## Findings beyond that

NONE. Pure core (`decide-landed-but-open`) stays small; observe+nudge-only
contract preserved; subject-only git read still avoids trap (a).

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1104-qa-landed-ticket-never-closed-strands-in-active`.

By cleaner.
