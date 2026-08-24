# BL-1093 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `572a19ba37` (nobody-assignee normalisation so exactly
one of dispatch-gap / unassigned-active claims each ticket) into
`swarmforge-cleaner` via `git merge --no-ff`.
Ancestry: `git merge-base --is-ancestor 572a19ba37 HEAD`.

## Checks run

1. **Babashka unit** — `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb`:
   ALL PASS (incl. BL-1093 spelling matrix).
2. **Sibling unit** — `bb swarmforge/scripts/test/landed_but_open_test_runner.bb`:
   OK (shares active-dir listing).
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1093-an-active-ticket-with-no-real-assignee-strands-between-two-sweeps.feature`:
   8/8 pass.

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb` — degraded gate is the unit suite.

## Cleanup performed

- Extracted private `list-active-yaml-items` so `read-active-items`,
  `read-unassigned-active-items`, and `read-active-ticket-ids` share one
  dir-scan/parse path. The complementary nobody filters stay the only
  difference between the two sweeps (invariant 1).

## Findings beyond that

NONE. `nobody-assigned?` + `nobody-assignee-spellings` are the right
single decision point; draft-lines/auto-route nil guard is correct
belt-and-braces without loosening the gate.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1093-an-active-ticket-with-no-real-assignee-strands-between-two-sweeps`.

By cleaner.
