# BL-1192 architect bounce (round 2) — 2026-08-28

## Review pass inventory

- **D1 — correctness defect: the mandated `abandoned_commits` override is
  entirely unimplemented.** The ticket description's "The corrected range
  needs the abandonment override too" section, added by the specifier's
  second amendment, states in terms that leave no room for deferral:

  > So the gate MUST honour the ticket's `abandoned_commits` field, the same
  > documented override `pre_qa_gate_lib.bb` already implements
  > (`read-abandoned-commits` / `abandoned-sha?` ...). When the previously-
  > cited commit is recorded as abandoned, the walk starts from `origin/main`
  > for that parcel rather than from a commit the new tip does not descend
  > from ...
  >
  > This is not optional polish. Without it the corrected range blocks the
  > one remedy available for the condition BL-1241 describes, which would
  > make this gate worse than the range it replaced.

  `swarmforge/scripts/task_scope_gate_lib.bb` never reads `abandoned_commits`
  from the ticket YAML, and neither `last-handoff-commit` nor
  `task-tagged-changed-paths` has any branch for a base commit recorded as
  abandoned — `grep -n abandoned` across the lib, its test runner, the
  acceptance feature, and the step handlers finds nothing but a doc-comment
  mentioning "completed/abandoned" handoff archive status, unrelated to the
  ticket-field override. `findings-for-git-handoff` doesn't even take ticket
  YAML content or an `abandoned_commits` list as an input — the current
  function shape cannot honour the override without a new parameter.

  Concrete failure scenario, the exact one the specifier's amendment names:
  a role rebuilds tip-pure off `origin/main` to escape an entangled tip
  (BL-1241's remedy) and records the abandoned commit in `abandoned_commits`.
  `last-handoff-commit` still returns the abandoned (pre-rebuild) commit as
  `base`. `task-tagged-changed-paths` walks
  `rev-list --first-parent base..commit`, which — because the rebuilt tip
  does not descend from the abandoned commit — either errors (git reports no
  merge base / an invalid range) or, if it resolves at all, does not contain
  the rebuilt commits actually carrying the task's real diff, so the walk's
  output does not reflect the rebuild the override exists to unblock. This
  is exactly "a gate that blocks the escape hatch for the very condition it
  detects," which the specifier called worse than no gate at all. It is not
  covered by any test: `task_scope_gate_lib_test_runner.bb` and the
  acceptance feature have no abandoned-commit or rebuild-with-override
  scenario (only a "rebuilding tip-pure" comment for a different, unrelated
  scenario at line 148 of the test runner).

  This is a correctness defect against an explicit, already-approved,
  hard-requirement line in the ticket's own spec — not a `rule_proposal` and
  not something to forward past. Per the architect role's own BL-333
  precedent, a defect I can see and name is a send-back, whatever else in
  the parcel is clean.

- required_wiring entry 1
  (`swarmforge/scripts/swarm_handoff.bb::task_scope_gate_lib.bb`): satisfied
  — loaded and called from `validate` beside the BL-953 and BL-760 guards
  (`swarm_handoff.bb:22`, call site near line 404).
- Dependency-rule gate (`extension/out/tools/dependency-gate.js` against
  `specs/pipeline/steps/bl1192TaskScopeGateSteps.js`): PASSED, no forbidden
  edges (Babashka files are outside this gate's scope by design).
- Co-change report: `swarm_handoff.bb` is a high-frequency shared hub file
  co-touched by nearly every gate ticket this shift — expected, not a
  coupling defect.
- Invariants (Babashka scripts have no property-testing infrastructure wired
  per the shared Engineering Rules' explicit Babashka/Clojure gap — gated
  only by their own unit-test suite): the three declared invariants are
  otherwise well covered by `task_scope_gate_lib_test_runner.bb`'s extensive
  example suite and by the fail-open/positive-identification design
  documented in the lib's own header comment. No invariant-unencoded finding
  beyond D1's coverage gap, which is a correctness gap in the mechanism
  itself, not a missing-test gap around an implemented mechanism.
- Correctness read otherwise: `own-evidence-path?`, `ticket-id-for-path`'s
  path-shape restriction, and `commit-message-names-task?`'s subject-only
  primary-id extraction all match the corrected spec and are exercised by
  the test runner. No other defect found.

## Remediation

Coder: read the named task's `abandoned_commits` field from its ticket YAML
(reuse `pre_qa_gate_lib.bb`'s `read-abandoned-commits` reader; do not
duplicate the parser). When `last-handoff-commit` returns a commit recorded
as abandoned for this task, start the walk from `origin/main` instead (per
the ticket's own remedy: "the walk starts from origin/main for that
parcel"), so a recorded rebuild's own paths are seen and correctly not
reported as foreign. Add a test/scenario reproducing the qa_e2e_procedure's
required check 2: "confirm a rebuild-off-main parcel with `abandoned_commits`
recorded passes cleanly." Forward back through cleaner → architect once
added.

## Commit reviewed

7a3773c711 (cleaner's merge of coder's rebuild chain: 620a36c96, 501e0a933,
4d339e827).
