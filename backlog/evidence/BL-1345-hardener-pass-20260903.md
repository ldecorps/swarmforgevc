# BL-1345 hardener pass — 2026-09-03

Merged architect commit `6bb1b9152d` (D1 fixed, clean sweep) onto this
worktree — clean merge, no conflicts.

## Context
This ticket was previously bounced by the architect for D1
(`backlog/evidence/BL-1345-architect-bounce-20260903.md`): invariant 2's
reach floor for `assigned === observed` was drawn independently from
`fc.constantFrom` over 5 roles at low `numRuns`, giving a measured
5/50 (~10%) intermittent failure. The coder's rework replaced the draw
with an explicit `CASES` list enumerating `{rotationRouter, sameRole}`
and a deterministic modular offset for the mismatching arm.

## D1 fix re-verified independently
`npx vitest run --config vitest.properties.config.mjs
bl1345StaleMarkerInvariants`, re-run **15 consecutive times, 3/3 pass
every time, 0 failures** (architect independently ran 40/40, cleaner
15/15) — the flake is genuinely gone.

## required_wiring / production code
`specs/pipeline/steps/index.js::bl1345StaleRouterMarkerStaffingSteps`
registered. Production diff (`babysitter_check.bb`,
`remote_control_health_lib.bb`, `swarm_ensure.bb`) is byte-identical to
what the architect's original (pre-bounce) pass already reviewed in
full — confirmed via `git diff` showing no production changes between
the bounce and this rework, only the property test file changed. No
re-review of the production logic needed beyond that confirmation.

## Re-run independently
- `bb swarmforge/scripts/test/bl1345_stale_marker_test_runner.bb` — ALL
  PASS.
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — ALL PASS (51
  tests, the hotfix baseline).
- `node specs/pipeline/cli.js
  specs/features/BL-1345-a-stale-router-marker-does-not-staff-a-standing-pack.feature`
  — 7/7 pass.

## BL-113 Gherkin soft mutation
One `Scenario Outline:`. Ran fresh (`mktemp -d`, deleted after): **3/3
killed, 0 survived, 0 errors**.

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/` and adds a new
`extension/test/` property test. Ran all 17 `test/*Guard*.test.js`
(excluding `.property.` siblings). Same 3 pre-existing, already-ticketed
failures as this session's earlier passes (BL-1289/1290/1291) —
confirmed by reading each guard's violation list directly (not just
grepping for the ticket id, per the lesson from this session's BL-1333
pass, which found a real NEW violation this same way): none names
`bl1345StaleRouterMarkerStaffingSteps.js`,
`bl1345StaleMarkerInvariants.property.test.js`, `babysitter_check.bb`,
`remote_control_health_lib.bb`, or `swarm_ensure.bb`.

## Other checks
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean.

## Verdict
D1 confirmed genuinely fixed; no other defect. Forwarding to documenter.
