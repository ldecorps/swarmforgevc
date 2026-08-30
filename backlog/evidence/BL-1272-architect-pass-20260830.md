# BL-1272 — architect pass, 2026-08-30

Reviewed the cleaner-forwarded commit `064de3be6` (cleaner merged coder
`ec0584131b` with no additional cleanup commit of its own).

## Verdict: COMPLIANT — forwarded to hardender

## Dependency-rule gate (BL-259, hard gate)

Full-repo scan (files straddle the `extension/` boundary):
`cd extension && node out/tools/dependency-gate.js` →
`Dependency-rule gate PASSED: no forbidden edges.`

## Co-change tool (BL-255)

Ran against `land_step_lib.bb`, `land_step_cli.bb`, and the new property
test. All co-changes are at or below frequency 2 (this ticket's own files
plus BL-1241, the ticket it directly extends) — no suspected coupling
outside the ticket's own footprint.

## Correctness read

Read `sibling-landed?`, `attribution-complete?`, and `landed-siblings`
directly (`swarmforge/scripts/land_step_lib.bb`). The fail-closed posture is
real, not asserted: `sibling-landed?` requires `complete?` AND `(seq paths)`
AND every attributed path byte-identical — nil/empty paths or an incomplete
walk both fall through to "not landed" (still entangled), matching invariant
1. `attribution-complete?`'s `diff-readable?` probe issues the exact same
`git diff-tree --no-commit-id --name-only -r --first-parent <commit>`
invocation and exit-code check that `task_scope_gate_lib.bb`'s own
`own-commit-diff` uses internally — a faithful re-check of the same failure
condition, not a second, divergent notion of "readable." `entangled-siblings`
keeps `:entangled` as the full set feeding `land-plan`'s decision, confirmed
by reading `land-plan` itself: it destructures `entangled` (not `unlanded`)
for its `cond`, so the action is genuinely unchanged (invariant 2) — only the
CLI's print statements and the escalation note read `:unlanded`/`:landed`.

## Invariants Review (BL-654)

Both declared invariants carry property tests
(`extension/test/bl1272LandedSiblingInvariants.property.test.js`).
Independently re-run rather than trusted:
`cd extension && npx vitest run --config vitest.properties.config.mjs
test/bl1272LandedSiblingInvariants.property.test.js` → 3 tests, all green.
Re-ran `bb swarmforge/scripts/test/land_step_lib_test_runner.bb` (ALL PASS)
and both acceptance features myself:
`specs/pipeline/scripts/run_acceptance.sh` on BL-1272's feature (6/6) and
BL-1241's feature (4/4, confirming BL-1241 is not disturbed).

## Required wiring

- `specs/pipeline/steps/index.js::bl1272LandedSiblingSteps` — registered
  (`index.js:892`).
- `swarmforge/scripts/land_step_cli.bb::LANDED_SIBLING` — confirmed present,
  printed alongside `ENTANGLED_SIBLING` for the replay case.

## Property Testing pass (undeclared coverage)

No additional pure/testable module beyond the two declared-invariant
property tests already covers this parcel's new logic; no further property
test needed.

## Surfaced, not acted on

Coder's evidence records that `swarmforge/roles/QA.prompt`'s whole BL-1241
prose contract (not just this ticket's `LANDED_SIBLING` addition) is absent
from `main` — a specifier-domain (Article 1.2) documentation gap, already
routed as a `note` to the specifier per the evidence file. Not
re-actioned here; outside architect domain and already correctly routed.

## Merge-up bookkeeping (same session, prior to this parcel)

Before this parcel arrived, two QA merge-up broadcasts (BL-1250 at
`7b08b2777`, BL-1183 at `14478ca6c`) were merged into this branch. The
BL-1250 merge-up conflicted with BL-1240's own in-progress (bounced) state
on this branch — non-conflicting portions of that merge silently dropped
BL-1240 content that was still active (a `require` line in
`specs/pipeline/steps/index.js`, the whole `unregistered_test_gate_lib.bb`
wiring block in `swarm_handoff.bb`, `parcel-own-changed-paths` in
`task_scope_gate_lib.bb`, and a manifest row) — each caught by re-running
the affected suites after the merge (a `swarm_handoff.bb --help` smoke test
surfaced the `task_scope_gate_lib.bb` regression directly as an unresolved-
symbol crash) and restored by hand from this branch's pre-merge HEAD. This
parcel's own merge (cleaner → architect) then re-introduced a duplicate
manifest row and two additional hardener-authored test cases in
`unregistered_test_gate_lib_test_runner.bb` via an add/add conflict,
resolved by keeping both sides' additive content and deduplicating the
manifest. All resulting suites (`task_scope_gate_lib_test_runner.bb`,
`unregistered_test_gate_lib_test_runner.bb`, `suite_inventory_cli.bb`,
`land_step_lib_test_runner.bb`) reconfirmed green after each merge.
