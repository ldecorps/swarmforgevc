# BL-1243 — architect review

Architect, 2026-08-30. Reviewed cleaner's merge of coder's `1a3917b406`
(cleaner made no further changes). No merge conflicts.

## Checks run, all clean

- `node extension/out/tools/dependency-gate.js` (full-repo AND the parcel's
  own changed files) — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js` — all flagged pairs are
  within the pre-existing Live Screen console family
  (`residentPaneSpy.ts`, `residentSpyUiHtml.ts`, `pipelineGridLive.ts`, their
  tests); no surprising coupling.
- Invariants Review (BL-633/654): both declared invariants have live,
  non-vacuous property tests
  (`bl1243PaneActivityInvariants.property.test.js`). Re-ran
  `npm run test:properties -- bl1243`: 4/4. Invariant 1 is stated as an
  implication over the REAL reader lifted out of `residentSpyUiHtml.ts`
  (not a hand-copied restatement of `resolvePaneStatusKind`), with the
  aggregate drawn adversarially INCLUDING `ok` so a never-green aggregate
  can't hide the defect. Invariant 2 replaces every `child_process` entry
  point with a throw for 200 runs to prove no second capture is reachable —
  behavioral, not a grep.
- Re-ran the coder's headline claims directly:
  - `npx vitest run test/bl1243PaneActivitySignal.test.js`: 7/7.
  - `npm run test:properties -- bl1243`: 4/4.
  - `node specs/pipeline/cli.js specs/features/BL-1243-...feature`: 6/6.
  - Full `vitest run --config vitest.config.mjs`: 26 failed / 218 failed —
    identical to the standing baseline. No regression.
- Read the source directly: `derivePaneActivitySignal` in
  `residentPaneLive.ts` is pure (no import of `tmuxClient`'s capture
  functions), reuses `isPaneActivelyProcessing` from `panel/agentPaneState.ts`
  rather than re-deciding "busy" (confirmed against the seven real BL-970
  capture fixtures the unit test drives), and `tryCaptureRolePane` sets
  `activitySignal` from the SAME `paneText` variable it already captured —
  no second `capturePane` call added (confirmed: still exactly the two
  pre-existing call sites on this path, matching scenario 04's own count).
- Cost condition (the operator's own stop condition) verified independently:
  `capturePane(` call sites on the Live Screen path are unchanged at 2.

## Observation, not a defect: scenario 02's "never captured" row tests a
## state the real writer cannot currently produce

`tryCaptureRolePane` has a PRE-EXISTING guard (confirmed via `git log -p`,
present before this ticket touched the file) that returns `undefined` for
the whole snapshot whenever the captured pane text is blank
(`if (!paneText.trim()) { return undefined; }`) — so a blank capture never
reaches the point where `activitySignal` gets set at all; it becomes a fully
`available: false` pane via that older path, not an `available: true` pane
with a `stale` signal.

`derivePaneActivitySignal` itself has a defensive `if (!paneText.trim())
return 'stale'` branch, and the acceptance step handler for the "never
captured" Examples row calls `derivePaneActivitySignal` directly with a
blank fixture and constructs `{ available: true, paneText: '', activitySignal:
... }` by hand (`bl1243LiveScreenPerPaneActivitySteps.js` line ~83) — it does
not go through `tryCaptureRolePane`. So the scenario validates the PURE
FUNCTION's own contract correctly (given blank text, never answer `ok`), but
the specific combination it constructs (`available: true` with blank
`paneText`) cannot currently arise from the real capture path, because the
older guard already turns that case into `available: false` upstream.

This is defense-in-depth, not a wrong behavior — invariant 1 ("never green")
holds either way, doubly so. But the evidence file's framing ("a fresh poll
paints the dead pane green... the acceptance caught it on the first run")
reads as if this were a reachable production regression; it is only
reachable by calling the pure function directly, bypassing the pre-existing
guard. Not bounce-worthy (no invariant is violated, no wrong behavior ships,
and the defensive branch is reasonable — it protects a future caller of
`derivePaneActivitySignal` that isn't `tryCaptureRolePane`), but worth
recording so a future reader does not go looking for a live "blank-but-
available" pane in production and fail to find one.

No functional defect found. Forwarding to hardener.
