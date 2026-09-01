# BL-1322 architect pass — 2026-09-01

Role: architect
Verdict: PASS — no architecture violation, invariant correctly encoded, forwarding to hardener.

## What was reviewed
Coder commit `4c88141782` (cleaner pass NONE on `3c5476fdaf`): moves
`resolveCursorApiKey(targetPath)` from `createLiveCursorBridgeAgentSession`'s
top level into `ensureAgent`, the sole call path that actually opens a Cursor
SDK agent (invoked only from `promptAgent`). Matches the ticket's declared
invariant and "how" direction exactly — a 2-line move, no behavior change to
the error message or its surfacing point.

## Checks run
- `node out/tools/dependency-gate.js` (full-repo scan): PASSED, no forbidden
  edges. A scoped-args invocation on just this parcel's `.js` files reported
  an `acyclic` cycle between `bl726Bl718AcceptanceFeatureHasNoStepHandlersSteps.js`
  and `specs/pipeline/steps/index.js` — confirmed pre-existing (present with
  just those two files alone, absent from the full-repo scan, unrelated to
  any file this parcel touches) and already documented as the known
  scoped-subset artifact in `backlog/evidence/BL-1313-...-architect-bounce-20260901.md`.
  Not a new violation.
- `node out/tools/co-change-report.js` over the parcel's changed files:
  suspected-coupling hits are all with files already inside the Cursor
  bridge subsystem (own test file, `bridgeServer.ts`, `telegramCursorBridge*`,
  `letsTalk*`) — expected historical coupling for this module, not a new
  cross-boundary coupling.
- Invariants review (BL-633/654): ticket declares one invariant
  ("Constructing/starting a bridge server never requires CURSOR_API_KEY by
  itself — only actually sending a prompt to the Cursor SDK agent does").
  `test/cursorBridgeAgentSessionLazyApiKey.property.test.js` encodes it
  directly: generates arbitrary prior state + non-prompt op (readAgentId /
  resetSession / construct-only) with CURSOR_API_KEY absent and asserts none
  throw, then asserts `promptAgent` always throws the documented message.
  Re-ran green; non-vacuity already demonstrated in the coder's commit
  message (fails against the pre-fix eager-resolution code, passes after).
- Independently re-ran: `npm run compile` (clean); `vitest run
  test/cursorBridgeAgentSession.test.js` (67/67); `vitest run --config
  vitest.properties.config.mjs cursorBridgeAgentSessionLazyApiKey` (1/1);
  `node specs/pipeline/cli.js specs/features/BL-1322-...feature` (4/4); the 8
  previously CURSOR_API_KEY-broken bridge files from BL-1313's QA evidence
  (bridgeServer, epicMakeTopBridge, epicReorderBridge, pausedPagerBridge,
  specTreeBridge, startBridgeHeadlessCli, telegramCursorBridgeCli,
  topicMakeTopBridge) — 210/210 pass, no CURSOR_API_KEY failures.
- No correctness defect spotted; two-layer boundary, extension-host I/O
  ownership, webview storage, and secrets-in-env rules are all unaffected by
  this diff (pure production-code timing change plus tests/step handlers).

## Conclusion
Architecturally compliant, invariant test present and non-vacuous, fix
verified working end-to-end. Forwarding to hardener on the cleaner's commit.
