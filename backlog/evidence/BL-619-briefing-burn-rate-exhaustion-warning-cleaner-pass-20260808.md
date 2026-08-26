# BL-619 cleaner pass — 20260808

## Scope reviewed
- `extension/src/metrics/burnProjection.ts`, `burnSectionText.ts`, `usageAnchorStore.ts`
- `extension/src/tools/token-burn-section.ts`, `usage-anchor.ts`
- `swarmforge/scripts/briefing_email_lib.bb` (prepend-content-block, maybe-mark-subject wiring)
- `swarmforge/scripts/handoffd.bb` (token-burn-briefing-section adapter)
- `specs/pipeline/steps/bl619TokenBurnWarningSteps.js`, `specs/features/BL-619-briefing-burn-rate-exhaustion-warning.feature`
- `swarmforge/scripts/test/bl619_token_burn_briefing_harness.bb`, `briefing_email_test_runner.bb` additions

## Checks run
- `npm run compile` (extension) — clean.
- `npx vitest run` on the 5 BL-619 test files — 48/48 pass.
- `npx vitest run --coverage` on the same — burnProjection.ts 131/131, burnSectionText.ts 37/37,
  token-burn-section.ts 57/57 statements covered; usageAnchorStore.ts 74/76, usage-anchor.ts 41/45
  (remaining lines are defensive CLI error branches exercised by the acceptance-level subprocess
  scenarios, not vitest-instrumented since those run out-of-process).
- `node specs/pipeline/cli.js specs/features/BL-619-briefing-burn-rate-exhaustion-warning.feature`
  — 14/14 scenarios pass.
- `bb swarmforge/scripts/test/briefing_email_test_runner.bb` — ALL PASS (includes the new
  prepend-content-block / maybe-mark-subject / :token-burn-section adapter assertions).
- `node extension/out/tools/mutation-site-count.js` on the 5 new/changed TS files (BL-485):
  burnSectionText.ts 41, usageAnchorStore.ts 84, token-burn-section.ts 36, usage-anchor.ts 55 — all
  within the 100-site threshold. `burnProjection.ts` is 154 (over).
- `npx jscpd --config .jscpd.json src/metrics src/tools` — 15 clones found repo-wide, none touching
  any BL-619 file (all pre-existing in the telegram-bridge modules).

## BL-485 mutation-site-count: burnProjection.ts (154/100) — split declined
Considered a split along the file's own two documented sections: weekly-reset config/clock math
(`parseWeekday`, `parseWeekResetConfig`, `nextWeeklyResetMs`, `currentWeeklyWindowStartMs`) vs.
rate-derivation/decision (`deriveBurnRateFromAnchors`, `computeProjectedExhaustionMs`,
`decideProjection`, `composeBurnSection`). Declined: `composeBurnSection` (the module's one real
composition point) reads `resetConfig.config` directly to derive the window and next-reset instant
in the same function that then derives the rate and decision — the two "sections" are not
independently reusable, they are one pure decision pipeline over one input shape. A split would
touch 5 more files' imports (`usageAnchorStore.ts`, `burnSectionText.ts`, `token-burn-section.ts`,
`burnProjection.test.js`, `bl619TokenBurnWarningSteps.js`) for no gain in reuse or clarity — the
BL-485 "legitimately-cohesive large module a split would only harm" exception applies.

## Defects found
None. No behavior changes made; no code changes made.
