# BL-766 architect pass — D1 fix verified, forwarded

## What was reviewed

Cleaner forwarded `f770651a08` (merge of coder `ebee786f`, "BL-766: fix D1
architect bounce — enable resolveJsonModule in tsconfig"), on top of the
previously-reviewed `9ef5931c`. This is the coder's response to the sole
finding in
`BL-766-mini-app-lets-talk-retired-without-its-server-half-bounce-20260802.md`.
Diff from the reviewed commit: `extension/tsconfig.json` (+1 line,
`"resolveJsonModule": true`) plus the coder's own evidence file — no other
production or test file touched.

## D1 — required gate cannot execute: FIXED, independently reverified

- `npm run compile` (from a fresh `extension/`): **exit 0**, clean. Was
  `TS2732` exit 2 before the fix.
- `npm run crap:lets-talk-cursor-bridge`'s two halves re-run independently
  end-to-end (not just re-trusted from the coder's own evidence):
  - `npx vitest run --coverage --poolOptions.forks.maxForks=1 <BL-766 scope
    patterns>`: first attempt hit one flaky failure
    (`test/startBridgeHeadlessCli.test.js`'s real-subprocess smoke test timing
    out its 5s `BRIDGE_LISTENING` poll) under extreme, unrelated host
    contention at the time (`uptime` load average 372/341/263 from a
    concurrent cleaner-worktree Vitest run, confirmed via `lsof -a -d cwd` on
    the PIDs — a different worktree's legitimate work, not touched).
    Reproduced the CLI manually outside the test harness (`node
    out/tools/start-bridge-headless.js <tmp> <port>` with `BRIDGE_TOKEN` set):
    it printed `BRIDGE_LISTENING port=<port>` correctly, just ~20s later than
    under normal load — confirms the fixture's fixed 5s deadline, not the
    code, is what the load exceeded. Re-ran the full coverage suite once the
    contending run finished: **573/573 pass, 22/22 files, clean.**
  - `node scripts/letsTalkCursorBridgeCoverage.js` + `node
    scripts/crapReport.js <all 12 required_wiring files>`: both ran to
    completion and produced a real report covering all 12 files
    (`letsTalkCore.ts`, `letsTalkRoutes.ts`, `letsTalkAudio.ts`,
    `letsTalkLocalAudio.ts`, `letsTalkUiHtml.ts`, `cursorBridgeAgentSession.ts`,
    `cursorBridgeTelegramHtml.ts`, `telegramCursorBridgeCore.ts`,
    `telegramCursorBridgeLive.ts`, `telegramCursorBridgePilot.ts`,
    `telegram-cursor-bridge.ts`, `start-bridge-headless.ts`) — confirms
    D1's remediation ("confirm it produces an actual report covering every
    live Let's Talk source") independently, not by trusting the coder's claim.
- `npx vitest run --config vitest.properties.config.mjs
  test/letsTalkGateScope.property.test.js`: 3/3 pass (re-verified through the
  now-working `npm run compile` path, no longer needing the prior bounce's
  `out/`-bypass workaround).
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-766-mini-app-lets-talk-retired-without-its-server-half.feature`:
  5/5 scenarios pass (re-verified cleanly through the real compile path).
- `node extension/out/tools/dependency-gate.js src/bridge/letsTalkGateScope.ts
  test/letsTalkGateScope.property.test.js` (node 22, via nvm — node 20 is
  outside dependency-cruiser's supported range): **PASSED, no forbidden
  edges.** Unchanged from the prior pass; re-run for the record since node
  version had to be switched.
- `co-change-report.js`: not re-run — no source/test file changed in this
  round beyond the prior pass's already-reviewed 4 files; `tsconfig.json` is
  a build-config file outside the dependency/co-change graph.

## Pre-existing debt surfaced by the now-working gate — NOT BL-766's, already routed

With the gate executing for the first time, `letsTalkCursorBridgeCoverage.js`
reports overall coverage 89.6% (below the 90% scoped-file threshold, driven by
`telegramCursorBridgeLive.ts` at 77.1%) and `crapReport.js` finds 25 functions
over CRAP<=6, concentrated in `telegramCursorBridgeLive.ts` (18, worst
CRAP=1406.36) and `telegramCursorBridgeCore.ts` (6), plus two minor ones in
`letsTalkRoutes.ts` (CRAP=12.49) and `letsTalkCore.ts` (CRAP=8.00).

Confirmed none of these four files are in BL-766's own diff (`git diff --stat
2bb77aea..9ef5931c` — the 4 files BL-766 actually changed are
`letsTalkGateScope.ts`, `letsTalkGateScope.property.test.js`,
`bl766MiniAppLetsTalkRetiredSteps.js`, `specs/pipeline/steps/index.js`). Per
the coder's own fix evidence, `git log` on the two worst-offending files traces
this debt to BL-764 (`7c0cd3a1`, `230cf5ea`, `b44f62ca`, landed 2026-08-01,
before D1's compile blocker existed) — it predates and is unrelated to BL-766.
BL-766's own `required_wiring` line ("gate scope matches the surfaces still
served") is about the gate correctly *covering* every live file, which is now
true (12/12, `letsTalkUiHtml.ts` restored) — it does not ask this ticket to
bring pre-existing, unrelated functions under the CRAP threshold. Already
flagged by the coder to the coordinator via `note` per their own evidence file
so it is tracked rather than rediscovered; not re-flagging here, but recording
it so the hardener isn't blindsided mid-pass and does not mistake BL-764's
debt for something BL-766's own hardening work must absorb.

## Blocked checks

None — the one flake above was re-run to a clean pass, not left blocked.

Disposition: D1 resolved, independently reverified rather than trusted from
the coder's evidence. Architecture boundary, invariants, and property
coverage are unchanged from the pre-D1 pass (already clean, re-verified where
cheap to do so). Forwarded to hardener.

By architect.
