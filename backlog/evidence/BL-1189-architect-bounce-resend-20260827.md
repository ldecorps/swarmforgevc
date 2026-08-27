# BL-1189 architect bounce (resend) — 2026-08-27

## Context

Same session-wide pattern as `BL-1188-architect-bounce-missing-live-report-fix-20260827.md`.
The original bounce (`BL-1189-architect-bounce-20260827.md`, D1 leaked
`mkdtempSync`, D2 feature file never committed) never delivered to coder
(session-wide branch corruption). Per coordinator's "BL-1189 bounce still
not sent to coder - please resend", resending from the recovered tip —
but the tree has moved since the original bounce, so re-verified fresh
rather than blindly resending stale content.

## D2 (original bounce): RESOLVED, not re-bounced

`specs/features/BL-1189-live-screen-one-primary-working-ticket.feature` is
committed in HEAD (restored by coordinator's 13-file recovery, `0bf05774a`).

## D1 (original bounce) — STILL LIVE: leaked `mkdtempSync` fixture directory

**File:** `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`
**Class:** behavior (resource-hygiene, BL-971)
**Blamed role:** coder

Line 36 `fs.mkdtempSync(...)`, still zero `afterEach`/`finally`/`rmSync`
anywhere in the file. Reproduced fresh this pass: running the acceptance
suite leaked 5 new `/tmp/bl1189-aps-*` dirs (timestamps match this run,
confirmed via `ls -la --time-style=full-iso`). Same remediation as before:
an unconditional cleanup hook at each scenario's true terminal
fixture-touching step (see `bl1188PipelineGridLiveStageParitySteps.js`'s
`cleanupFixture(ctx)` for the just-landed, already-reviewed reference
shape for this exact file family).

## D-NEW — required_wiring gap: `resolveResidentHeldTicketMeta` / `tryCaptureRolePane` fix missing

**Files:** `extension/src/concierge/residentPaneSpy.ts`,
`extension/src/bridge/residentPaneLive.ts`
**Class:** behavior (required_wiring / regression)
**Blamed role:** coder — not new authorship, content already existed and
needs reinstating (see Root cause).

The ticket's `required_wiring` declares `residentPaneSpy.ts::
resolveResidentHeldTicketMeta` (must gate on `isTicketActive`) and
`residentPaneLive.ts::tryCaptureRolePane` (must thread a shared
`claimedTicketIds` Set through `dedupePrimaryWorkingTicket`). Neither
`isTicketActive` nor `dedupePrimaryWorkingTicket` exists anywhere in this
tree at the reviewed commit (grep: zero matches both files).

Confirmed with hard evidence, exact same shape as BL-1188's D1:
- `extension/test/residentPaneSpy.test.js` / `residentPaneLive.test.js`
  are themselves the PRE-fix versions (18 and 17 tests, not the reviewed
  22/19 — no `BL-1189`/`isTicketActive`/`dedupePrimaryWorkingTicket`
  reference anywhere in either file). They pass, but only because they no
  longer test the ticket's own invariants at all.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`:
  3/4 RED, `TypeError: dedupePrimaryWorkingTicket is not a function`.
- Full acceptance run (via `specs/pipeline/runnerAdapter.js`'s
  `runPipeline` against the feature file + this ticket's own step module):
  0/5 scenarios pass, same `dedupePrimaryWorkingTicket is not a function`
  at every scenario reaching the capture step.

## Root cause (not a defect in any fresh coder delivery — nothing fresh has been delivered for this ticket since the revert)

`isTicketActive` and `dedupePrimaryWorkingTicket` existed correctly in
coder's original `e8e14057e` (reviewed and passed — see "Passed checks" in
the original `BL-1189-architect-bounce-20260827.md`). They were removed by
`1fcd4c167` ("BL-1189: revert bounced coder content out of architect
branch (BL-490/BL-495)"), the correct-at-the-time surgical revert paired
with `4188b77e0`'s BL-1188 revert (same commit family, same entangled-batch
exception, same original bounce). That bounce never delivered (session
corruption), so no re-fix ever returned through the pipeline. Coordinator's
13-file recovery restored this ticket's step handler, property test, and
feature file (files entirely absent from disk) but NOT
`residentPaneSpy.ts`/`residentPaneLive.ts`/their `.test.js` files, which
were never absent from disk — only holding stale, reverted content. Same
root cause, same fix shape as BL-1188's already-confirmed, already-fixed
D1 (`git show e8e14057e -- extension/src/concierge/residentPaneSpy.ts
extension/src/bridge/residentPaneLive.ts` is the reference diff).

## Disposition

Bounced to **coder**, one bounce, two items (D1 fixture leak + D-NEW
required_wiring gap) per Article 4.4.
