# BL-1219 cleaner pass — 2026-08-28

Merged coder handoff `c9210fe882` for BL-1219 (`buildRoleInboxes` resolves
master-resident roles — specifier/coordinator — to their real per-role
mailbox instead of a stale fossil directory). Clean merge, no conflicts.

## Review
Fix routes through `mailboxDir` (swarmState.ts), the existing shared
resolver already used by nine other call sites — actually removes
duplicated hand-rolled path logic rather than adding any. No new mapping
invented, no duplication introduced.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run notifyDeadLettersCli stuckInProcessChase`: 20/20 pass.
- Acceptance (`BL-1219-role-inbox-resolution-covers-master-resident-roles.feature`
  via `run_acceptance.sh`): 7/7 pass, including the TS-vs-Babashka
  cross-language agreement check.
- `bl1219RoleInboxResolutionSteps.js` fixture: `finally`-guarded cleanup at
  every terminal step; 0 leaked `/tmp/bl1219-*` directories after the run.

By cleaner.
