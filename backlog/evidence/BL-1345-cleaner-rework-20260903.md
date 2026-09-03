# BL-1345 — cleaner re-review after architect bounce D1 (2026-09-03)

## Context

Architect bounced BL-1345 for D1: invariant 2's "never exercised a correctly
staffed pane" reach floor was drawn from an independent `fc.constantFrom`
pair rather than an enclosing-loop case — the identical shape to BL-1352's
own D1, reproduced by the architect at 5/50 runs (~7-10%).

## D1 verified fixed

- `bl1345StaleMarkerInvariants.property.test.js` invariant 2 now enumerates
  an explicit `CASES` list (match/mismatch/router), same remedy BL-1352
  used. Re-ran `npx vitest run --config vitest.properties.config.mjs
  bl1345StaleMarkerInvariants` **15 consecutive times — 0/15 failures**.
- `bb swarmforge/scripts/test/bl1345_stale_marker_test_runner.bb` — ALL
  PASS.
- `run_acceptance.sh specs/features/BL-1345-…feature` — 7/7 pass.

## Production code unchanged

`git diff` of `babysitter_check.bb`, `remote_control_health_lib.bb`, and
`swarm_ensure.bb` between my prior approved review (`bda6223a33`) and this
rework (`767cc08e4d`) is empty — only the property test file changed, per
the coder's own commit message ("production fixes were clean, so they are
reapplied unchanged"). No re-review of the production logic needed beyond
this confirmation.

## Verdict

D1 fixed, nothing else changed. Forwarding.
