# BL-1097 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `2274b46dd2` (refuse re-routing tickets that already
have a dispatch trail; shared `ticket-dispatched?` / `dispatch-trail-dirs`)
into `swarmforge-cleaner` via `git merge --no-ff`. Ancestry:
`git merge-base --is-ancestor 2274b46dd2 HEAD`.

## Checks run

1. **Babashka unit** —
   `bb swarmforge/scripts/test/bl1097_router_dispatch_trail_test_runner.bb`:
   ALL PASS.
2. **Shell integration** —
   `bash swarmforge/scripts/test/test_bl1097_router_refuses_dispatched_ticket.sh`:
   ALL PASS (01–07).
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked.feature`:
   4/4 pass (after wiring fix below).

Property suite not run (cleaner does not own property tests). CRAP/mutation/DRY
tooling not wired for `.bb`/shell — degraded gate is the suites above.

## Cleanup performed

- Fixed `specs/pipeline/steps/index.js`: coder tip terminated the DOMAINS
  array with `;` after `bl1097RouterNoOpOriginationSteps`, so every later
  require was dead syntax and acceptance could not load. Restored the
  trailing comma so the full domain list registers.

## Findings beyond that

NONE. `ticket-dispatched?` correctly reuses `decide-dispatch-gaps` (invariant
2 by definition); `dispatch-trail-dirs` is the single shared dir set;
`dispatch_trail_cli.bb` is a thin shell seam. Fail-open when the CLI cannot
answer is the safer router posture.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1097-the-router-re-routes-a-ticket-that-has-already-been-worked`.

By cleaner.
