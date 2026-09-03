# BL-1345 — architect re-review after bounce (2026-09-03)

## Context

My prior pass (`00b43d2341`/`1193b48d22`) bounced this ticket for D1:
invariant 2's "never exercised a correctly staffed pane" reach floor was
drawn from two independent `fc.constantFrom` draws over 5 roles rather than
an enclosing-loop case, giving a reproducible ~10% intermittent failure
(measured 5/50 runs).

## D1 fix verified

Coder's rework (`66914ab628`) replaces the independent-draw shape with an
explicit `CASES` list enumerating `{rotationRouter, sameRole}` (all four
combinations as loop cases, not draws), and derives the mismatching arm's
`observed` role from `assigned` via a `1..n-1` modular offset — guaranteeing
`observed !== assigned` whenever `sameRole` is false, and `observed ===
assigned` whenever it is true. `reach.match`, `reach.mismatch`, and
`reach.router` are therefore each hit by construction on every run, exactly
the same remedy BL-1352's own D1 used.

Independently re-ran **40 consecutive times — 0/40 failures** (cleaner
separately measured 15/15). The flakiness is genuinely gone, not merely
less frequent.

## Production code confirmed unchanged

`git diff 1193b48d22~1 606a425b33 -- swarmforge/scripts/babysitter_check.bb
swarmforge/scripts/remote_control_health_lib.bb
swarmforge/scripts/swarm_ensure.bb` is empty — the three production fixes
are byte-identical to what I already architecturally reviewed and approved
before the bounce. Only the property test file changed. No production
re-review needed beyond this confirmation; my prior pass's architecture
findings (single shared `resolve-resident-role` decision, `assigned-role-mismatch`
placed after `actionable?`, BL-1020/BL-648/BL-804 constraints honored) still
hold unchanged.

## Independently re-run

- `npx vitest run --config vitest.properties.config.mjs
  bl1345StaleMarkerInvariants` — 40/40 runs green (0 failures).
- `bb swarmforge/scripts/test/bl1345_stale_marker_test_runner.bb` — ALL PASS.
- `run_acceptance.sh specs/features/BL-1345-…feature` — 7/7 pass.
- `bash swarmforge/scripts/test/test_swarm_ensure.sh` — ALL PASS (51 tests,
  the hotfix baseline).
- Dependency-rule gate (BL-259), scoped and full-repo: PASSED, no forbidden
  edges.

## Verdict

D1 fixed and verified. No other defect. Forwarding to hardener.
