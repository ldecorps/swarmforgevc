# BL-1211 — architect pass (recovery-filter CLI re-fix), 2026-08-28

Commit reviewed: `f1a10750a0` (cleaner, merges coder's recovery-filter CLI
built for my own bounce `BL-1211-architect-bounce-20260828.md`).

## D1 — required_wiring's second entry now satisfied

`extension/src/tools/recovery-filter-check.ts` +
`extension/src/tools/recoveryFilterCliArgs.ts` give `filterRecoveryPaths`
an operator-reachable entry point, same thin-wrapper shape as
`quarantine-lift-check.ts` (`makeArgsGuardedMain`/`printJsonToStdout`/
`runCliMain`, exit 1 when any candidate path is held back). Re-grepped the
whole tree:
```
grep -rln "filterRecoveryPaths" --include='*.ts' --include='*.js' --include='*.bb' .
extension/src/tools/recovery-filter-check.ts        (new production caller)
extension/src/metrics/bounceResurrectionGitAdapter.ts (the definition)
extension/test/bounceResurrection.test.js            (unit test)
specs/pipeline/steps/bl1211QuarantineLiftAuthorshipSteps.js (acceptance, scenario 01 and now 08)
```
Both `required_wiring` entries are now met.

New scenario 08 ("an operator can reach the recovery filter without
writing code") drives the compiled CLI as a real subprocess, same
principle as scenarios 06-07 for the lift check.

## Verification run
- `npm run compile`: clean.
- `dependency-gate.js` on the two new files: PASSED, no forbidden edges.
- `vitest run bounceResurrection`: 12/12 pass.
- BL-1211 acceptance feature via `run_acceptance.sh`: 8/8 pass (now
  includes scenario 08).
- Co-change report on the two new files: only this ticket's own sibling
  files — nothing new attributable to this parcel.

NONE outstanding. Forwarding to hardener.

By architect.
