# BL-795 architect bounce — 2026-08-03

## Defect inventory (Article 4.4 — complete pass)

- **D1** — class: `acceptance`, blamed role: **coder**. Commit reviewed:
  `9172fda839` (merged with `main` to pick up the specifier's spec-gap
  remediation `a1106143`, which added
  `specs/features/BL-795-mono-router-starvation-hand-fix.feature`).
  Verified directly by running
  `node specs/pipeline/cli.js specs/features/BL-795-mono-router-starvation-hand-fix.feature`:
  all 5 scenarios fail with `no step handler matched "Given a mono-router
  pack whose home role is coder"` (and downstream steps). Per the
  "Amending an In-Flight Ticket's Spec" rule ("A spec amendment that adds
  SCENARIOS also adds work: wire step handlers in the same parcel or the
  acceptance runner hard-fails on unhandled scenarios" — BL-233), this
  parcel does not carry that wiring yet. Remediation: land step handlers
  for all 5 scenarios (mono-router-starvation-hand-fix-01..05) covering the
  three declared invariants plus the BL-576 fresh-note guard, following the
  precedent named in the specifier's own remediation note:
  `specs/pipeline/steps/bl636RotatePreferenceParcelPrioritySteps.js`
  (drive the real `handoffd.bb`/`mono_router_lib.bb`/`chase_sweep_lib.bb`
  via the existing wiring shell tests, no hand-built score rows).
  Observation only, not verified by this review: the coder's own worktree
  (`swarm/coder` branch, commit `38268d27` "wire acceptance step handlers
  for the starvation hand-fix feature") appears to already contain this
  work — it was never forwarded through cleaner/architect. If so this
  should be a fast re-forward, not new implementation; still subject to
  full review once it reaches architect again.
- No other defects found in this pass.
  - Dependency-gate hard gate: N/A — this parcel touches no `extension/`
    (TypeScript) files, only `swarmforge/scripts/*.bb`, backlog/specs. The
    tool correctly errors "can't open" on `.bb` paths (out of its scope);
    confirmed no `extension/` files in `git show 9172fda839 --stat`.
  - Co-change report: run against the three changed `.bb` files; the
    reported "suspected coupling" is exactly the file set already changed
    together in this same commit (`mono_router_lib.bb`, `handoffd.bb`,
    `chase_sweep_lib.bb`, their test runners) — informational, no missed
    site.
  - Declared invariants (BL-654): all three have either a non-vacuous
    property test (invariants 1 and 3 — independently re-run by this
    review, `ALL PROPERTIES HOLD` both) or a stated non-encodability
    reason backed by a real-fixture wiring test (invariant 2 — reasoning
    reviewed and accepted: the redirect decision is inlined in otherwise
    impure daemon control flow; extracting it would exceed this ticket's
    adopt-as-is scope, and no Babashka property-test framework is wired
    for this layer). No invariant violation found on hand review of
    `chase-rotate-to!`/`attempt-resident-rotate!`.
  - Property Testing pass (undeclared): no additional property-shaped
    pure module surfaced beyond the declared invariants; `actionable-mail?`
    is the only new pure function and it is already covered.
  - Regression sweep (independently re-run, not just trusted from coder's
    evidence): `mono_router_lib_test_runner.bb`,
    `test_handoffd_rule_proposal_rotate_wiring.sh` (A/B/C),
    `test_chase_sweep.sh` (all 19 scenarios), `test_handoffd_chase_sweep_wiring.sh`,
    `chase_activity_nudge_test_runner.bb`, `mono_router_lib_property_runner.bb`,
    `handoff_lib_test_runner.bb` — all green.

## Routing

Sending back to **coder** (this is the earliest-blamed role for D1, and the
only defect found). Task name and commit lineage preserved.
