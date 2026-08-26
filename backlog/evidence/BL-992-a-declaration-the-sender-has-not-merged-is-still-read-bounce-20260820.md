# BL-992 architect bounce — 2026-08-20

Reviewed commit: b8c57d8dbad1c8ddd2b4fadeb38eae1150d40982 (cleaner's fixture-
cleanup pass on top of coder's 9f3e75fced8… fix), merged into the architect
worktree at 184705cd8.

## Review pass (Article 4.4 complete inventory)

- Dependency gate (`node extension/out/tools/dependency-gate.js`): N/A — no
  `extension/src/**` or `extension/media/**` file is touched by this
  parcel (changed files are `swarmforge/scripts/swarm_handoff.bb`,
  `swarmforge/scripts/test/bl992_declaration_ref_lookup_property_runner.bb`,
  `specs/pipeline/steps/bl992UnmergedDeclarationSteps.js`,
  `specs/pipeline/steps/index.js`). Out of the gate's scope, not run.
- Co-change report (`node extension/out/tools/co-change-report.js` against
  the 4 changed files): flags `required_stages_lib.bb`, `handoff_lib.bb`,
  `handoffd.bb` (6 co-changes each) as suspected coupling. All three are
  explicitly named in the ticket's own `constraints:` as OUT OF SCOPE for
  this parcel ("Any change to resolve-effective... in required_stages_lib.bb"
  / "Any other reader of backlog/active/ ... widening the fix to all of
  them is a separate sweep"), and the coder's commit message states the
  same boundary was honored. No action — informational, matches the
  ticket's own stated scope.
- Invariants review (3 declared): each has a property-encoded check in
  `bl992_declaration_ref_lookup_property_runner.bb` (inv 1: local-ahead /
  origin-ahead / both draws; inv 2: no-ref / nowhere draws; inv 3: collision
  draws). Verified non-vacuous via the break-then-fix record in the
  runner's own header comment and reproduced independently below. Code
  read of `declaration-refs`/`ticket-yaml-at-ref` in `swarm_handoff.bb`
  confirms the freshness comparison and exact-id recheck match the
  invariants' text.
- Acceptance suite: re-ran `specs/features/BL-992-....feature` — 5/5 PASS.
  Re-ran the shared-fixture sibling `specs/features/BL-951-....feature` —
  7/7 PASS (no regression). Re-ran
  `swarmforge/scripts/test/test_required_stages_ticket_lookup_collision.sh`
  — ALL PASS. Confirmed no `sfvc-bl992-` fixture dirs leak after the
  acceptance run (cleaner's afterEach fix verified working).

## D1 — property runner's DEFAULT sample size does not reliably clear its own declared reach floors (class: behavior, blamed: coder)

`bl992_declaration_ref_lookup_property_runner.bb` hardcodes
`(def runs (or (some-> (System/getenv "PROPERTY_RUNS") parse-long) 24))` —
i.e. a bare invocation (`bb .../bl992_declaration_ref_lookup_property_runner.bb`,
no env override) draws only 24 samples, uniformly distributed across 6
shapes, against **absolute** reach floors that sum to 21
(local-ahead>=4, origin-ahead>=4, both>=3, no-ref>=3, nowhere>=3,
collision>=4). This is the exact same class of defect already fixed today
on the sibling runner for BL-982 (24→100, see cleaner's 2026-08-20m status:
"fixing a flaky property-runner reach floor").

Reproduced live, twice, at the shipped default, both runs completing and
both FAILING on coverage (never on a property violation):

```
run 1: {:local-ahead 3, :origin-ahead 6, :both 1, :no-ref 5, :nowhere 5, :collision 4}
  -> local-ahead reached only 3 of 24 (floor 4)
  -> both reached only 1 of 24 (floor 3)

run 2: {:local-ahead 5, :origin-ahead 4, :both 8, :no-ref 2, :nowhere 3, :collision 2}
  -> no-ref reached only 2 of 24 (floor 3)
  -> collision reached only 2 of 24 (floor 4)
```

Both the coder's and cleaner's own recorded evidence used an explicit
`PROPERTY_RUNS=40` override to get a clean pass (coder: "final 40-draw run
8/10/6/5/5/6 ALL PROPERTIES HOLD"; cleaner: "property runner 40/40 draws
... reach floors all met") — neither ever validated the script's own
shipped default. Any future re-run at the default (hardener's own
verification pass, QA, a CI lane, or any other role that just runs the
script bare, which is the documented invocation shown in the runner's own
usage) has a high chance of a false-red FAIL that reads exactly like a
regression, per
`lesson_property_runner_reachability_floors_are_absolute_not_scaled.md`.

This is not a property violation — the underlying fix in `swarm_handoff.bb`
is sound (5/5 acceptance, 7/7 sibling regression, collision shell test all
pass, code read confirms the freshness/exact-id logic matches the
invariants' text). It is a reliability defect in the shipped test harness's
default sample size.

**Remediation**: raise the hardcoded default in
`bl992_declaration_ref_lookup_property_runner.bb` (currently `24`) to a
value that reliably clears all six reach floors — mirror today's BL-982
fix (24→100) unless a smaller value is shown to be reliable across
several repeated default runs. Re-verify with a handful of repeated
DEFAULT (no `PROPERTY_RUNS` override) invocations, not a single lucky run.

## Verdict

Sent back to coder. Do not forward to hardender.
