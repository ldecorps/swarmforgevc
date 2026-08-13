# BL-881 — coder pass, bounce re-entry (2026-08-13)

Addresses the architect's bounce (`backlog/evidence/BL-881-bounce-20260813.md`,
commit tested `73a6e5e88`), item D1 — the only item raised.

## D1 — `nowMs` DI seam not wired at its one production call site

`extension/src/bridge/bridgeServer.ts:1550`: `captureMonoRouterLiveScreen`'s
call site in `buildJsonRoutes` now threads the enclosing `nowMs` through,
matching the three sibling routes in the same table
(`buildStageDwellState`/`buildBurnRateState`/`capturePipelineGridLive`):

```
compute: () => captureMonoRouterLiveScreen(targetPath, nowMs),
```

One line changed. `nowMs` is `number | undefined` in `buildJsonRoutes`'s
scope; `captureMonoRouterLiveScreen`'s own `nowMs: number = Date.now()`
default parameter accepts `undefined` directly (confirmed via `npm run
compile` — no cast needed, the architect's own fallback suggestion was not
required).

## New test (BL-881 bounce regression)

`extension/test/bridgeServer.test.js`: `threads the server-injected nowMs
through to captureMonoRouterLiveScreen (BL-881 bounce)`. The response body
alone can't distinguish the bug from the fix (no live tmux pane in the
fixture, so `/resident-pane`'s JSON is the same "unavailable" sentinel
either way) — so this spies on `residentPaneLive`'s exported
`captureMonoRouterLiveScreen` (`vi.spyOn`, same pattern as
`tmuxClient.test.js`'s `sleepSync` spy) and asserts the server-injected
`nowMs` (via `withBridge(target, { nowMs: FIXED_NOW_MS }, ...)`, the same
fixed-clock pattern the `/stage-dwell`/`/pipeline-board` tests already use)
reaches the call, not a live `Date.now()` value.

**Non-vacuous, confirmed live**: reverted the compiled call site back to
`captureMonoRouterLiveScreen(targetPath)` (no `nowMs` arg) in `out/`, reran
just this test — failed (`expected 1786611600000, got undefined`).
Restored the fix, reran — passed. No broken variant was ever committed.

No invariant-review or property-test work needed — the ticket's three
declared invariants (BL-654) were already covered by the pre-existing
`residentPaneLive.property.test.js`, confirmed unaffected by the architect's
own evidence and re-confirmed by this pass's own rerun below; this bounce is
a pure wiring gap with no invariant surface of its own.

## Acceptance (BL-112)

`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-881-resident-pane-live-capture-ttl-cache.feature`: **3/3
scenarios pass**, unaffected (none of the three drives `/resident-pane`
through `bridgeServer.ts`; they exercise `residentPaneLive.ts` directly).

## Verification

- `npm run compile` (tsc): clean.
- `npx vitest run test/bridgeServer.test.js`: **84/84 pass** (83
  pre-existing + 1 new).
- `npx vitest run test/residentPaneLive.test.js`: **12/12 pass**, unchanged.
- `npx vitest run --config vitest.properties.config.mjs
  test/residentPaneLive.property.test.js`: **1/1 pass**, unchanged.
- Acceptance: 3/3 scenarios pass (above).

By coder.
