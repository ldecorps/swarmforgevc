# BL-1409 — coder spec-gap fix, 2026-09-06

Applied the specifier's amendment (ticket `notes:`, verbatim) after QA's
`spec-gap` bounce on scenario 04 (BL-1448's case 11 was hidden behind case
07's own pre-existing red until this ticket fixed 07):

- `specs/features/BL-1409-bl570-wiring-assertion-follows-the-delegation.feature`:
  scenario 04 replaced verbatim with
  `case-07-follows-the-delegation-and-the-suite-runs-past-it-04` — "Then
  case 07 passes / And every case through 10 passes" instead of "every case
  passes".
- `specs/pipeline/steps/bl1409Bl570WiringFollowsTheDelegationSteps.js`:
  scenario 04's handler now asserts `PASS: 07:`..`PASS: 10:` lines in the
  shell suite's own output, never `rc == 0` — the boundary stays true once
  BL-1448 lands (BL-1006, never red-when-correct).

## Checks

- `specs/pipeline/scripts/run_acceptance.sh` on this ticket's feature: 5/5
  (was 4/4 + the broken scenario 04 before this fix).
- `npx vitest run --config vitest.properties.config.mjs test/bl1409PropertyGuardWiringInvariants.property.test.js`: 3/3, unaffected.
- Merged `main` (4bf85aef2c, carrying the specifier's amendment note and
  BL-1348's re-pend) and QA's bounce commit `cb9d7363d2` (bounce_history
  entry) into this worktree first; both merges clean, no conflicts.

Re-forwarding to cleaner per the ticket's own routing instruction.

By coder.
