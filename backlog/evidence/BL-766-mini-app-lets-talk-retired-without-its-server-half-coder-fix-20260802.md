# Coder fix — BL-766 architect bounce (D1)

Bounce reviewed: `backlog/evidence/BL-766-mini-app-lets-talk-retired-without-its-server-half-bounce-20260802.md`
(architect, commit `ff3e4fc312`, D1 — BLOCKING: compile failure short-circuits every
BL-766 gate script).

## Fix

Added `"resolveJsonModule": true` to `extension/tsconfig.json`'s `compilerOptions`
(the exact line the architect confirmed correct, uncommitted, in the human's main
checkout). One line, no other file touched.

Verified: `npm run compile` now exits 0 cleanly from a fresh worktree state (was
`TS2732` on `letsTalkChiptunes.ts`'s JSON import, exit 2).

## Gate re-run — `npm run crap:lets-talk-cursor-bridge`

Host was under severe, self-inflicted load while iterating on this (see below) — the
FINAL clean run, after clearing that load:

```
npx vitest run --coverage --poolOptions.forks.maxForks=1 <scope>
 Test Files  22 passed (22)
      Tests  573 passed (573)
   Duration  12.56s
```

`node scripts/crapReport.js <all 12 required_wiring target files>` then ran to
completion and produced a report covering every one of the 12 files
(`letsTalkCore.ts`, `letsTalkRoutes.ts`, `letsTalkAudio.ts`, `letsTalkLocalAudio.ts`,
`letsTalkUiHtml.ts`, `cursorBridgeAgentSession.ts`, `cursorBridgeTelegramHtml.ts`,
`telegramCursorBridgeCore.ts`, `telegramCursorBridgeLive.ts`,
`telegramCursorBridgePilot.ts`, `telegram-cursor-bridge.ts`,
`start-bridge-headless.ts`) — confirmed present in the report output. This satisfies
the bounce's remediation ("confirm it produces an actual report covering every live
Let's Talk source").

D1 is fixed: the gate can now execute end-to-end. `npm run compile`,
`npm run test`, `npm run test:properties`, `npm run coverage*` and
`npm run crap:lets-talk-cursor-bridge` all now reach their real tool instead of
dying on `tsc`.

## New finding (NOT BL-766's — recorded here so downstream isn't blindsided)

With the gate actually running for the first time, it surfaces **25 pre-existing
functions over the CRAP<=6 threshold**, concentrated in two files BL-766 never
touches:

- `src/tools/telegramCursorBridgeLive.ts` — 18 violations, worst
  `handleOperatorGateDecision` complexity=47, coverage=15%, **CRAP=1406.36**.
- `src/tools/telegramCursorBridgeCore.ts` — 6 violations, worst `parseChoicePoll`
  complexity=7, coverage=31%, CRAP=23.26.
- One in `letsTalkRoutes.ts` (`processLetsTalkTurn`, CRAP=12.49) and one in
  `letsTalkCore.ts` (`isLetsTalkTurnRequestShape`, CRAP=8.00).

`git log` on the two worst-offending files shows their content came from BL-764
(`7c0cd3a1`, `230cf5ea`, `b44f62ca` — "front desk fans Host/Bubble updates...",
"mutation-harden the Host/Bubble bridge fan-out...", "dedupe cursor-topic vs
bubble-topic..."), all dated 2026-08-01 02:19–07:14, **before** `f175bc56` (23:52
the same day) introduced the compile blocker D1 fixes. So the compile blocker is
not why this was missed — this gate's CRAP threshold was already unmet by the time
BL-764 landed; nothing about BL-766 or this fix created it.

Not fixing it here: BL-766's own diff is 4 files, none of which is
`telegramCursorBridgeLive.ts` or `telegramCursorBridgeCore.ts`; bringing 25
functions (one at complexity 47) under CRAP<=6 is real, substantial hardener-owned
work (Article 1.6), not a one-line tsconfig bounce-fix's scope. Flagging via `note`
to the coordinator so it gets tracked rather than silently rediscovered — this
parcel's own hardener pass will still hit this same gate and needs the context
above rather than re-diagnosing from zero.

## Aside — self-inflicted host load during verification (no code implication)

Early re-runs of the full gate under default `maxForks: 6` repeatedly crashed with
`Unhandled Rejection: Terminating worker thread` (tinypool) before writing
`coverage-final.json`. Root cause: each crashed run orphaned its forked workers
(reparented to PID 1, confirmed via `lsof -a -d cwd`, all still `cwd`'d into this
worktree's `extension/`) instead of being reaped, and repeated retries compounded
until `uptime` load average hit ~380 on a 4-core host. Killed the 16 verified-orphaned
PIDs (exact list, all confirmed cwd'd in this worktree — never a bare `pkill`), after
which a `--poolOptions.forks.maxForks=1` run completed cleanly in 12.56s with no
crash. Recorded here only so nobody mistakes those numbers for a code regression;
no production or test file changed as a result.
