# BL-1211 architect bounce — 2026-08-28

Commit reviewed: c914c4044365186ff4991a4abe0756428e8e3425 (cleaner, "operator
CLI verified, flake stays fixed across 8 runs" — merges coder's
097c265735, "land the operator-facing quarantine-lift CLI (scenarios
06-07)").

## D1: `required_wiring`'s second entry is unmet — `filterRecoveryPaths` has
no operator-reachable entry point (correctness/scope, BL-419 shape)

The ticket declares two `required_wiring` entries, both added by the
2026-08-28 amendment and both stated as necessary for the same reason —
"Unwired, neither [invariant] holds":

1. `quarantineLiftCheck::the lift verdict must have a production caller` —
   **satisfied**. `extension/src/tools/quarantine-lift-check.ts` wraps it,
   `quarantineLiftCliArgs.ts` parses its flags, and acceptance scenarios
   06-07 drive the compiled CLI as a real subprocess. Verified working:
   `run_acceptance.sh` on the BL-1211 feature is 7/7 green, including both
   new scenarios.

2. `filterRecoveryPaths::the recovery half needs the same
   operator-reachable entry point; a recovery that cannot consult the
   filter still resurrects bounced content` — **not satisfied**. Grepped
   the whole tree (excluding `out/` build output):
   ```
   grep -rln "filterRecoveryPaths" --include='*.ts' --include='*.js' --include='*.bb' .
   extension/src/metrics/bounceResurrectionGitAdapter.ts   (the definition)
   specs/pipeline/steps/bl1211QuarantineLiftAuthorshipSteps.js  (test-only, scenario 01)
   extension/test/bounceResurrection.test.js               (test-only)
   ```
   No CLI, script, or other production caller reaches `filterRecoveryPaths`
   anywhere. The new `quarantine-lift-check.ts` only imports and calls
   `quarantineLiftCheck` (confirmed by reading the file — single import
   line `import { quarantineLiftCheck } from '../metrics/bounceResurrectionGitAdapter'`);
   it does not import or expose `filterRecoveryPaths` at all. Scenarios
   06-07 in the feature file test only the lift-check CLI, not any
   recovery-side entry point — there is no scenario exercising an operator
   running a recovery through the filter.

This is not a style nitpick: the ticket's own description names the
concrete failure mode this leaves open — "a recovery that cannot consult
the filter still resurrects bounced content" is exactly the BL-1189
incident this ticket exists to prevent, and it can still happen today by
hand, the same way the original incident did, because nothing operator-
facing calls the filtering logic. This is the BL-419 shape the ticket's
own required_wiring section was written to catch: `filterRecoveryPaths`
is correct and unit/acceptance-tested (scenario 01) but unreachable from
production.

The ticket's own notes anticipated the shape of the fix without mandating
its exact location: "hosting both verbs in one CLI is direction, not
mandate." Coder chose to build only the lift-check verb. The recovery verb
(a CLI or script that performs a restore-from-sibling filtered through
`filterRecoveryPaths`, or at minimum exposes it standalone the way
`quarantine-lift-check.ts` exposes `quarantineLiftCheck`) is still
missing.

## Remediation
Add an operator-reachable entry point for `filterRecoveryPaths` — either a
second CLI (e.g. `extension/src/tools/recovery-filter-check.ts`, same thin-
wrapper shape as `quarantine-lift-check.ts`) or a second verb on the
existing one — plus an acceptance scenario exercising it as a real
subprocess (same principle scenarios 06-07 already used for the lift
check). No change to `filterRecoveryPaths` or `quarantineLiftCheck`
themselves is needed; both are correct and already covered by scenarios
01-05.

## Complete inventory (Article 4.4)
Everything else checked and clean — recorded so it isn't re-run redundantly
on the re-fix:
- Dependency gate (`extension/out/tools/dependency-gate.js` against the two
  new files): PASSED, no forbidden edges.
- Co-change report: no coupling beyond the ticket's own three files
  (quarantine-lift-check.ts, quarantineLiftCliArgs.ts, the step-handler
  file) — expected, not a finding.
- `tsc`/`npm run compile`: clean.
- `vitest run bounceResurrection`: 12/12 pass (D1 flake from the earlier
  cleaner bounce stays fixed).
- Acceptance feature (`BL-1211-quarantine-lift-cannot-restore-reverted-
  bounce-content.feature`): 7/7 pass via `run_acceptance.sh`, including the
  new operator-CLI scenarios 06-07.
- Invariants 1-3: unchanged from my prior pass
  (`backlog/evidence/BL-1211-architect-pass-20260828.md`) — still hold,
  independently re-verified there was no regression in this merge.
- No other correctness defect found.

By architect.
