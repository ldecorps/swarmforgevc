# BL-1322 cleaner pass — 2026-09-01

Role: cleaner
Verdict: NONE — no defect found, no cleanup change needed.

## What was reviewed
Coder commit `4c88141782` moves `resolveCursorApiKey(targetPath)` out of
`createLiveCursorBridgeAgentSession`'s top level and into `ensureAgent`
(the sole caller path that actually opens a Cursor SDK agent), exactly
matching the ticket's declared invariant and "how" direction. Diff is a
2-line move plus new coder-authored tests (unit, property, acceptance step
handlers).

## Checks run
- `npm run compile` (extension) — clean.
- `node out/tools/mutation-site-count.js src/bridge/cursorBridgeAgentSession.ts`
  → 304 sites, `over` the 100-site advisory threshold (BL-485). Pre-existing
  file size, not introduced or grown by this ticket's 2-line diff. The file
  mixes lock/state management, a front-desk one-shot runner, and live/mock
  Cursor session construction — a plausible future split candidate, but
  splitting it now is out of this ticket's declared scope (moving a key
  resolution's timing) and risks unrelated behavior change under time
  pressure. Left whole; recorded here as an advisory, not actioned.
- `vitest run test/cursorBridgeAgentSession.test.js` — 67/67 pass.
- `vitest run --config vitest.properties.config.mjs cursorBridgeAgentSessionLazyApiKey` — 1/1 pass.
- `node specs/pipeline/cli.js specs/features/BL-1322-bridge-startup-does-not-require-cursor-api-key.feature` — 4/4 scenarios pass.
- Re-ran the 8 previously-newly-failing files from BL-1313's QA evidence
  (bridgeServer, epicMakeTopBridge, epicReorderBridge, pausedPagerBridge,
  specTreeBridge, startBridgeHeadlessCli, telegramCursorBridgeCli,
  topicMakeTopBridge) — 210/210 pass, none failing on CURSOR_API_KEY.
- `node scripts/crapReport.js src/bridge/cursorBridgeAgentSession.ts` — one
  violation: `runFrontDeskOneShot` complexity=6, coverage=0%, CRAP=42.00.
  Confirmed via `git log`/`git show HEAD~1:...` this function and its
  coverage gap PRE-DATE this ticket's diff (untouched by
  `4c88141782`) — out of this parcel's scope, not a regression introduced
  here. Not fixed in this pass to keep the parcel scoped to its own ticket
  (BL-1192 discipline).
- `npx jscpd --config .jscpd.json src/bridge/cursorBridgeAgentSession.ts` —
  0 clones, 0% duplication.

## Conclusion
No cleaner-owned defect in the changed code. Forwarding unchanged to
architect on the coder's commit.
