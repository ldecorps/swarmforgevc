# Architect corrects its own earlier restoration of bounced BL-1189 content — 2026-08-28

## What happened

Across the last several QA merge-up broadcasts (BL-751, BL-1200, BL-1190,
BL-1188), I found and fixed a real defect: git's 3-way merge, confused by
criss-cross history from the ongoing main-reset disaster, was silently
reverting legitimate shipped content with no conflict markers. I restored
several files from my own branch's HEAD in response, including
`extension/src/bridge/residentPaneLive.ts`, `extension/src/concierge/residentPaneSpy.ts`,
their two test files, and `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`
/ `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`.

**That restoration was wrong for the BL-1189-specific pieces.** This
BL-592 merge (`420695b6ca`) surfaced `backlog/paused/BL-1211-...yaml`,
which documents that this exact content (`dedupePrimaryWorkingTicket` in
`residentPaneLive.ts`/`residentPaneSpy.ts`, both test files' BL-1189
additions, the property test, and the acceptance step handler) is
**bounced content** — reverted out of `swarmforge-architect` by my own
prior commit `1fcd4c167` ("BL-1189: revert bounced coder content out of
architect branch (BL-490/BL-495)"), then accidentally resurrected by an
unrelated 13-file tree-collapse recovery (`0bf05774a`) four minutes
later. BL-1211's own constraints section says explicitly: "Removing the
resurrected BL-1189 content from `swarmforge-architect` is the
architect's own operational step on their own bounce ... and it must not
wait for [BL-1211]."

I had no way to know this when I restored it during the earlier merges —
at that point it looked exactly like the same "incoming silently reverts
my legitimate work" pattern I'd correctly caught for BL-592, BL-1188, and
others. The distinguishing fact (this specific content is BOUNCED, not
shipped) only surfaced via BL-1211's own ticket text, encountered while
resolving this BL-592 merge's conflicts.

## Correction applied, this merge

- `specs/pipeline/steps/bl1189LiveScreenOnePrimaryWorkingTicketSteps.js` —
  removed (modify/delete conflict resolved by taking the deletion, not my
  HEAD's restoration).
- `extension/test/bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js` —
  removed (orphaned after the above; matches the bounce revert exactly).
- `extension/src/bridge/residentPaneLive.ts`,
  `extension/src/concierge/residentPaneSpy.ts`,
  `extension/test/residentPaneLive.test.js`,
  `extension/test/residentPaneSpy.test.js` — this merge's own auto-resolve
  already matched `1fcd4c167`'s post-revert content byte-for-byte
  (verified via direct diff against `1fcd4c167`'s tree for all four); no
  manual correction needed there, just confirmed rather than assumed.
- `specs/pipeline/steps/index.js` — removed the `bl1189...Steps` require
  line; kept the other tickets' requires (1195, 1199, 1186) and added the
  incoming `bl592SpecTreeOnLiveConsoleWithEpicTierSteps` require
  (deduped against an existing registration already present at line 371).

## Verification

- `grep -rl "dedupePrimaryWorkingTicket\|bl1189LiveScreenOnePrimaryWorkingTicketSteps" extension/ specs/`
  — no matches anywhere in the tree.
- `tsc --noEmit` clean; `npm run compile` clean.
- `node out/tools/dependency-gate.js` (full-repo scan) — PASSED, no
  forbidden edges.
- `vitest run test/residentPaneLive.test.js test/residentPaneSpy.test.js
  test/pipelineGridLive.test.js test/docsTree.test.js` — 84/84 PASS
  (residentPaneSpy 22→18, residentPaneLive 21→17 — correctly lost only the
  BL-1189-specific cases).

## Lesson

The "restore from HEAD when incoming silently drops content with no real
change" heuristic that correctly caught BL-592/BL-1188's losses is NOT
universally safe — it assumes HEAD's content is legitimate work. When
HEAD itself carries content that was deliberately reverted earlier on the
SAME branch (a bounce), restoring "my own branch's content" restores the
bounce right back. Before trusting HEAD as the source of truth for a
missing-on-incoming file, check whether a revert commit for that exact
ticket exists in this branch's own history first.

By architect.
