# BL-1243 — architect re-pass after QA bounce, 2026-08-30

Reviewed the coder's answer to QA's bounce (`06f6feacd` fixing D1-D3,
`9f5a29f41` fixing D4), merged via cleaner (`94dd3ac86d`) into
`fe3b893a12`. My prior review (`179a03508c`) covered only the pre-amendment
5-scenario feature; this is a fresh full pass over everything that changed
since, per QA's own bounce inventory (`backlog/evidence/BL-1243-bounce-20260830.md`).

## D1 — invariant 3 (failing-poll err-suppression)

Confirmed fixed: `resolvePaneStatusKind` (`residentSpyUiHtml.ts:798`) now
checks `aggregateKind === 'err'` before the per-pane early return, scoped to
`err` only (a merely `stale` aggregate still yields to the pane's own
signal, matching invariant 3's wording exactly).

## D2/D3 — scenario 06's step handlers

Confirmed present and correct:
`specs/pipeline/steps/bl1243LiveScreenPerPaneActivitySteps.js`'s `When`
handler for "the poll is failing and a role pane's own last signal was ok"
sets `ctx.bl1243.aggregate = 'err'` against a pane fixture whose own signal
is `ok`; the reused `Then` step now reads `ctx.bl1243.aggregate ?? 'ok'`
instead of hardcoding `'ok'`, so scenario 06 actually exercises the `err`
branch.

## D4 — doc contradiction

Confirmed fixed: `docs/reference/Specification.MD`'s per-pane mapping
paragraph no longer says both "unavailable or never captured -> no signal"
and "a blank capture -> stale" as if they were the same case; it now scopes
"no signal" to no-capture-at-all and names the blank-capture case
separately as `stale`.

## Re-verified, not re-litigated (unchanged since my prior pass)

Invariants 1 and 2, and the original five scenarios — no file implementing
them changed between `179a03508c` and this commit.

## Checks run

- `cd extension && npx tsc -p .` — clean.
- `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1243-live-screen-per-pane-activity-signal.feature` —
  7/7 (matches QA's expected total, was 6/7 on the bounced commit).
- `npx vitest run test/bl1243PaneActivitySignal.test.js
  test/residentSpyUiHtml.test.js test/residentPaneLive.test.js --config
  vitest.config.mjs` — 47/47 green.
- `npx vitest run test/bl1243PaneActivityInvariants.property.test.js
  --config vitest.properties.config.mjs` — 4/4 green.
- `node extension/out/tools/dependency-gate.js src/bridge/residentSpyUiHtml.ts
  src/bridge/residentPaneLive.ts` — PASSED, no forbidden edges.
- `node extension/out/tools/co-change-report.js
  src/bridge/residentSpyUiHtml.ts
  specs/pipeline/steps/bl1243LiveScreenPerPaneActivitySteps.js` — only
  ordinary, already-updated companions (BL-1160 family, index.js, own
  test files). No action.
- `required_wiring`: both anchors present —
  `residentPaneLive.ts::activitySignal` (set at line 187 inside
  `tryCaptureRolePane`), `specs/pipeline/steps/index.js::bl1243LiveScreenPerPaneActivitySteps`
  (registered).

## Disposition

No violation, no correctness defect found on this pass. Forwarded to
hardender.
