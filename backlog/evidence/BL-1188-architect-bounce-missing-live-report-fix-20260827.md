# BL-1188 architect bounce — core live-report fix missing from pipelineGridLive.ts (2026-08-27)

## Reviewed commit

`afc32f5878` (cleaner's forward of coder's D2 fixture-leak fix), merged into
architect at `<this bounce's own commit, see git_handoff>`.

## D2 fix itself: PASSED

Coder's `cleanupFixture(ctx)` in
`specs/pipeline/steps/bl1188PipelineGridLiveStageParitySteps.js` correctly
removes the leaked `mkdtempSync` fixture dir at each of the 5 scenarios'
true terminal fixture-touching step, guarded by `finally` there and by
try/catch+rethrow at every earlier fixture-touching step in the same
scenario. Verified by direct reading against the feature file's 5
scenarios — no scenario can leak `ctx.gridRoot` on either the pass or the
throw path. D2 (the ticket this bounce was actually asked to fix) is
correctly resolved. Not what this bounce is about.

## D1 — required_wiring violation: `readLiveRoleHeldTickets` is missing

**File:** `extension/src/bridge/pipelineGridLive.ts`
**Class:** behavior (required_wiring / regression)
**Blamed role:** coder — but see Root cause below; this is not new content
coder needs to author, it is content that already existed and needs to be
correctly reinstated.

The ticket's own `required_wiring` declares:
`extension/src/bridge/pipelineGridLive.ts::readLiveRoleHeldTickets::PWA
grid capture must derive from live report like Telegram`. The function
does not exist anywhere in this file at the reviewed commit — grep
confirms zero matches. `capturePipelineGridLive` still calls
`invertTicketStageToRoleHeldTickets(readTicketStageMap(targetPath))`
directly (the pre-fix, cache-only path this ticket exists to replace).

Confirmed with hard evidence, not just static reading:
- `npx vitest run test/pipelineGridLive.test.js`: 3/6 RED —
  `TypeError: readLiveRoleHeldTickets is not a function` (x2) and the
  freshness-across-ticks assertion fails (cache-only render does not
  change between ticks).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1188PipelineGridLiveStageParityInvariants.property.test.js`: 3/3
  RED, including the file's own non-vacuity check
  ("non-vacuity: invariant 1 property would catch a cache-only
  implementation" — fails because the CURRENT implementation already IS
  the cache-only one it's supposed to catch).
- Full acceptance run (`node --test
  specs/pipeline/generated/pipeline-status-grid-matches-live-stage-report-for-claimed-work.generated.test.js`
  after `node specs/pipeline/generate.js`): 0/5 scenarios pass, same
  `readLiveRoleHeldTickets is not a function` at every scenario that
  reaches the capture step.

## Root cause (not a defect in coder's D2 delivery)

`readLiveRoleHeldTickets` and its caller-side `resolveRoleHeld` fallback
DID exist, correctly, in coder's original `daa10afce` ("fix(BL-1188):
pipeline STATUS GRID uses live stage report, not stale cache") — reviewed
and passed by architect at the time (see "Passed checks" in
`BL-1188-architect-bounce-20260827.md`). They were removed by
`4188b77e0` ("BL-1188: revert bounced coder content out of architect
branch (BL-490/BL-495)"), a correct-at-the-time surgical revert of
BL-1188's touched paths (D2/D3 were unresolved at that point, per BL-490/
495 the bounced content must leave the branch pending a re-fix).

That bounce then never delivered to coder (session-wide corruption; see
`architect-branch-severely-collapsed-tree-20260827.md`), so no re-fix ever
came back through the pipeline. Separately, coordinator's 13-file recovery
(`0bf05774a`) restored `pipelineGridLive.ts`'s SIBLING files — the test,
property test, feature file, and step handler — from the hardener branch
(because those were entirely absent from disk in this worktree), but
`pipelineGridLive.ts` itself was NOT part of that recovery: it was never
missing from disk, only holding stale (correctly-reverted-at-the-time,
never-re-fixed) content. The result is an inconsistent tree: callers
already expect the fixed API, the implementation does not provide it.

Likely the same pattern affects BL-1189's `residentPaneLive.ts` /
`residentPaneSpy.ts` (reverted by the sibling commit `1fcd4c167`, same
shape) — not reviewed here, out of this parcel's scope, flagging
separately via note.

## Disposition

- Bounced to **coder**. The fix is not new work: reinstate
  `readLiveRoleHeldTickets`/`resolveRoleHeld` and the
  `resolveRoleHeld`-based `capturePipelineGridLive` wiring exactly as
  `daa10afce` had it (`git show daa10afce -- extension/src/bridge/pipelineGridLive.ts`
  is the reference diff), then re-verify all three suites above green
  before re-forwarding.
- D2 (this ticket's own re-fix) is NOT being re-bounced — it already
  passed. This bounce is solely about D1 (the required_wiring gap).
