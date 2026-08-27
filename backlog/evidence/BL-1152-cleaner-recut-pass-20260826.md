# BL-1152 — cleaner re-cut pass — 20260826

- merge_and_process QA bounce `076e8fb6c4` (D1: tip entangled with BL-653/660/588/1162).
- Re-cut from `origin/main` @ `97394ccb3` via merge reconcile-import: hotfix
  `7380d80686` bot source + stamp-off tests/steps/docs only.
- Purity: no sibling hitchhikers in land diff vs `origin/main`.
- Verified: `vitest run test/telegramFrontDeskBotCli.test.js -t BL-1152` — 5/5 PASS.

By cleaner.
