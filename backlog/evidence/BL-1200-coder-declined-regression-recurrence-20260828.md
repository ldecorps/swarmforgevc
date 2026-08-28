# BL-1200 — coder declined the same recurring regression, plus caught its own BL-751-merge escape

**Fourth occurrence of the incident tracked in
`backlog/evidence/BL-592-documenter-declined-regression-20260828.md`,
`backlog/evidence/BL-1200-documenter-declined-regression-recurrence-20260828.md`,
and this branch's own `BL-592-coder-declined-regression-recurrence-20260828.md`.**

## What happened

Received QA merge-up note for BL-1200 (commit `6bc23c7def`), the very next
merge-up after BL-751's. Same lineage gap: descends from `f8a41c1e2` without
`779a036e5`. Merge reverted:

- `extension/src/bridge/pipelineGridLive.ts` — BL-1188's live
  `pipeline_stage_cli.bb`-read path (`resolveRoleHeld`)
- `extension/src/concierge/residentPaneSpy.ts` /
  `extension/src/bridge/residentPaneLive.ts` — BL-1189's
  `buildResidentHeldTicketMeta`/`isTicketActive` guard and the
  `dedupePrimaryWorkingTicket` cross-tile invariant
- `specs/pipeline/steps/bl1188PipelineGridLiveStageParitySteps.js`,
  `bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`,
  `bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` — deleted outright
- `extension/test/bl1188PipelineGridLiveStageParityInvariants.property.test.js`,
  `bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`,
  `pipelineGridLive.test.js` — deleted outright
- several evidence files
- `specs/pipeline/steps/index.js` — bl1188/bl1189 registrations dropped
  (real content conflict this time, not silent)

All restored via `git checkout HEAD -- <path>`.

## Self-caught regression from my own prior merge (86d147c21)

Re-running the full docsTree suite surfaced 3 pre-existing failures with no
connection to this merge's conflicts:
`extension/test/docsTree.test.js` still had 3 tests reading
`tree.milestones[0].tickets` directly (the pre-BL-592 flat shape) instead
of via the `ticketsInMilestone(...)` epic-flattening helper. Diffing against
this branch's pre-session tip (`5fd89f866`) showed the helper and its three
call sites had been silently dropped when I resolved this same file's
conflict markers during the BL-751 merge — the conflict only bracketed the
newly-appended BL-592 test block; the auto-merged region above it (no
markers) had quietly taken the QA side's older test bodies. Restored to
match `5fd89f866` exactly (verified with `diff`).

Lesson for next merge-up from this lineage: a clean `git diff HEAD` on a
UU-resolved file is not sufficient — diff the *whole* file against the
pre-merge tip, not just the marked hunks.

## Verification

`npm run compile` clean.
`npx vitest run test/docsTree.test.js test/pipelineGridLive.test.js
test/residentPaneLive.test.js test/residentPaneSpy.test.js
test/pwaDocsExplorer.test.js test/pwaLocale.test.js` — 149/149 passed.

## Disposition

Landed as `1a376039b`. `779a036e5` still not merged forward into the
QA-side lineage — expect this to recur on the next merge-up from it, per
the standing memory note. No new ticket minted (same BL-1216-family gap).

By coder.
