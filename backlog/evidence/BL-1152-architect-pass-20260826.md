# BL-1152 — architect pass — 20260826

- merge_and_process cleaner tip `ed564f76b5` (clean merge; merge commit on tip).

## Architecture / boundaries

- Stamp-off confirms landed hotfix `7380d80686` only — `git diff --quiet` against
  that commit for `telegram-front-desk-bot.ts` is empty.
- Hotfix paths stay in extension-host I/O layer: `resolveAskOptions` reads
  `.swarmforge/operator/hotfix-stamp-asks.json`; `applyHotfixStampAnswer` shells
  to `hotfix_ledger_update.bb --decide` via `spawnSync`; non-hotfix threads still
  use `awaiting-answer.json` + `postToBridge` — no webview/storage boundary breach.
- APS handler `bl1152ConcurrentHotfixStampAsksStampOffSteps` registered in
  `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Reimplementation invariant: step handler enforces `git diff --quiet` vs
  `7380d80686:extension/src/tools/telegram-front-desk-bot.ts`; parcel adds tests
  + steps only.
- Ledger invariant: acceptance steps assert routing to `hotfix_ledger_update --decide`
  and never auto-write `Hotfix-Certification: certified` — stamp-off leaves
  certification to human ledger decision per BL-848.

## Verification

- Dependency gate on `telegram-front-desk-bot.ts`: **PASSED**
- `vitest run test/telegramFrontDeskBotCli.test.js -t BL-1152`: **3/3 PASS**
- No additional undeclared property tests warranted (stamp-off confirm/refute parcel).

Inventory: NONE

Pass → hardender.

By architect.
