# BL-1211 cleaner pass (operator CLI, scenarios 06-07) — 2026-08-28

Merged coder handoff `097c265735` — closes the ticket's own
`required_wiring` gap (`quarantineLiftCheck` needed a production/operator
caller) and fills two acceptance scenarios (06-07) that existed in the
feature file with no step handlers. Resolved an add/add conflict in
`bl1211QuarantineLiftAuthorshipSteps.js` — purely additive on coder's
side, took the incoming scenario 06-07 block wholesale.

Also notable: coder's own commit message documents catching and fixing a
silent delete/delete-shaped drop from an earlier merge (git treating "my
side never touched this path" as consent to accept the other side's
delete for two live BL-1211 files) — restored from this branch's
pre-merge tip. Worth flagging as a live instance of this session's own
"merge can silently revert already-landed work" hazard class, caught
correctly here.

## Review
`quarantine-lift-check.ts`/`quarantineLiftCliArgs.ts` are clean thin
wrappers, same shape as `deliver-role-answer.ts`, reusing
`makeArgsGuardedMain`/`printJsonToStdout`/`runCliMain`. No duplication or
structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run bounceResurrection deliverRoleAnswerCli gitEnvGuard`: 25/25
  pass.
- `vitest run bounceResurrection` run 8 consecutive times: 12/12 pass
  every time — the scenario 05 flake stays fixed with this merge's
  content.
- Acceptance (`BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`
  via `run_acceptance.sh`) run 3 times: 7/7 pass every time (now includes
  the new CLI-driving scenarios 06-07), 0 leaked `/tmp/bl1211-*`
  directories.

By cleaner.
