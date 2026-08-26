# BL-1152 — cleaner pass — 20260826

- merge_and_process coder tip `7cd1d1ab39` (clean merge).
- DRY: `removeFixture`, `postToBridgeOrHotfixStampBody`, and
  `assertHotfixLedgerRouting` in `bl1152ConcurrentHotfixStampAsksStampOffSteps.js`;
  fixture cleanup uses try/finally (BL-971).
- Left `telegram-front-desk-bot.ts` byte-identical to hotfix `7380d80686` —
  stamp-off step enforces `git diff --quiet` against that commit.
- Verified: `npx vitest run test/telegramFrontDeskBotCli.test.js -t BL-1152` — 3/3 PASS.

By cleaner.
