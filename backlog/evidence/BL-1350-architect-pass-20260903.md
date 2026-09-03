# BL-1350 — architect pass, 2026-09-03

Reviewed cleaner commit `d956fb009b` (no defect, NONE-evidence path),
forwarding coder's `f65f7d8f2d` (SSE keepalive on the live bridge server).

## required_wiring verified
`writeSseKeepalive` confirmed defined inside `bridgeServer.ts` itself,
beside `sseClients` and the poll timer (not a separately-tested helper no
production path reaches) — read at `bridgeServer.ts:2290-2316`. A
`setInterval` in the same scope calls it (`:2320-2325`); `stop()` clears
`keepalive` alongside `poll` (`:2363-2364`), satisfying the constraint that
a surviving timer would hang the unit suite.

## Constraints verified
- Client races: a client with `writableEnded`/`destroyed` is dropped
  rather than written to; a throwing write also drops the client instead
  of escaping the timer loop — confirmed reading the guard.
- No real timers/sleeps: `keepaliveIntervalMs` is injectable, same pattern
  as the pre-existing `pollIntervalMs` — confirmed.
- BL-1111 alert untouched: `git diff --stat` on the coder's commit shows
  only `bridgeServer.ts`, `telegramFrontDeskBotCore.ts`, and this parcel's
  own test/step/evidence files — no alert or threshold file in the diff.

## Checks run (not assumed)
- `npx vitest run test/bridgeServer.test.js` — 99/99 pass (pre-existing
  suite, unmodified, still green).
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1350-idle-event-stream-keepalive.feature` — 4/4
  scenarios pass. (First run showed 2 failures, `drainBufferedRecords is
  not a function` — traced to my own worktree's stale `extension/out/`
  compiled build, not a defect; `npm run compile` resolved it and all 4
  passed. `exports.drainBufferedRecords` is present in the fresh build,
  matching the coder's claim that this export was deliberately added.)
- `node extension/out/tools/dependency-gate.js` on the property test —
  PASSED, no forbidden edges.
- Property test (`bl1350KeepaliveInvariants.property.test.js`, BL-654,
  both declared invariants): every reach counter increments
  unconditionally inside its own dedicated shape/window loop —
  deterministic by construction throughout (no probabilistic corner
  anywhere in this file). Ran 5 consecutive times — 5/5 clean.
- Invariant 2 (hold-open frame changes no consumer state) drives the REAL
  `drainBufferedRecords` from the shipped relay module, not a
  reimplementation — confirmed by reading the import
  (`require('../out/tools/telegramFrontDeskBotCore')`).

## Architecture read
Keepalive frame is a pure SSE comment (`: keepalive\n\n`), inert to both
the browser `EventSource` API and this repo's own SSE reader
(`parseNextSseRecord` matches neither `event: ` nor `data: `). No change
to the reply-relay's business logic, no change to the BL-1111 alert. The
one new export (`drainBufferedRecords`) is deliberate and commented as to
why — proving the invariant against the shipped loop rather than a test
reimplementation.

## Verdict
Clean sweep. No defect found. Forwarding to hardener.
