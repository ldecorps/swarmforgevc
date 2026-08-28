# BL-1211 cleaner pass (recovery-filter CLI, second required_wiring entry) — 2026-08-28

Merged coder handoff `f963201b44` — closes the ticket's second
`required_wiring` entry (`filterRecoveryPaths` needed the same
operator-reachable entry point as `quarantineLiftCheck`; unwired, "a
recovery that cannot consult the filter still resurrects bounced
content" — the exact original incident, still unaddressed for this half).
Resolved a trivial ticket-yaml bounce_history conflict (both bounce
entries kept, chronological).

## Review
`recovery-filter-check.ts`/`recoveryFilterCliArgs.ts` correctly mirror
`quarantine-lift-check.ts`'s own shape exactly — same thin-wrapper
pattern, same shared helpers. No duplication or structural issues.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run bounceResurrection`: 12/12 pass.
- Acceptance (`BL-1211-quarantine-lift-cannot-restore-reverted-bounce-content.feature`
  via `run_acceptance.sh`) run 2 times: 8/8 pass every time (now includes
  the new CLI-driving scenario 08), 0 leaked `/tmp/bl1211-*` directories.

Both `required_wiring` entries are now satisfied: `quarantine-lift-check.ts`
(prior pass) and `recovery-filter-check.ts` (this pass).

By cleaner.
