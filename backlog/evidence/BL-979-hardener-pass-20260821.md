# BL-979 — hardener pass: verified green, no code changes needed, PASS to documenter

**Parcel:** coder D1 refix `ae6d0070b` (re-express conciergeTick's two
pre-pivot header asserts) merged into cleaner `e8ad302017`, then architect
`00e4de90b1` (refix re-review PASS, `backlog/evidence/BL-979-architect-
refix-review-20260821.md`, reconciling the BL-986 branch-contamination
detour along the way). This is BL-979's SECOND pass through hardener — the
first bounced at architect for the stale conciergeTick asserts; this pass
verifies the refix and the axis-pivot renderer end to end.

## Independent reverification (registered detach, host load 47-88 throughout)

- `npm run compile`: clean.
- `conciergeTick.test.js` -> **111/111 PASS** (was 109/111 before the
  refix; the refix re-expresses the two pre-pivot header asserts against
  the row-per-ticket shape rather than weakening them — confirmed by
  reading the architect's refix review, and independently by reading the
  live test file's join logic: caption-vs-row rows are discriminated by
  SHAPE, and the role-held/BL-473 checks still assert the mark sits at the
  correct stage INDEX, not merely "some mark exists").
- `pipelineBoard.test.js` + `bl979PipelineBoardTicketRows.test.js` ->
  **141/141 PASS**.
- Board/concierge sweep (`pipelineBoardSync`, `pipelineBoardPinSync`,
  `conciergeTopicRouting`, `conciergeTickScheduler`, `runOneConciergeTick`,
  `conciergeTickRequest`, `residentPaneSpy`, `telegramFrontDeskBotCli`) ->
  **405/405 PASS** (the `blTopicStore: FAILED to commit...` lines in the
  log are fixture noise from a test that deliberately exercises the
  git-commit-failure path — not a real failure).
- Property tests (`pipelineBoard.property.test.js`,
  `bl956PipelineBoardCaptionCapInvariants.property.test.js`) ->
  **11/11 PASS**. Read the BL-979 property directly: constructed reach
  across under/exact/over the row budget, 4 id widths, 3 epic mixes, each
  asserted as a floor — not a uniform draw hoping to hit the edges.
- Acceptance: BL-585 **8/8**, BL-956 **5/5**, BL-979 **10/10**, all exit 0.

## CRAP — 7 pre-existing violations, none introduced by this parcel

`node scripts/crapReport.js src/concierge/pipelineBoard.ts` (scoped
coverage from the three test files above) flags 7 functions over CRAP<=6:
`renderParkedSectionHtml` (10.00), `composePipelineBoardHtml` (9.49),
`renderListSectionHtml` (8.19), `renderGridTapLinesHtml` (8.00),
`listSectionTicketIds` (7.00), `renderListSection` (6.13),
`formatCollapsedEpicLineHtml` (6.06). Checked each against
`git diff <main-merge-base> HEAD -- pipelineBoard.ts`'s hunk line ranges
(1-26, 220-253, 670-696, 723-812): every flagged function lives at line
884 or later, entirely outside the diff — these are the file's
pre-existing HTML-composition/list-section debt, untouched by the BL-979
pivot, and out of scope per the differential complexity gate. Every
function the pivot actually TOUCHED or ADDED (`renderGridLines`=4,
`renderGridMatrixLines`=1, `renderGridCaptionLines`=6,
`gridIdGutterWidth`=1, `gridLineWidth`=1, `maxVisibleGridRows`=1,
`epicSeparatorLine`=2, `stageCells`=1) reports at or under the threshold.
No CRAP fix needed.

## DRY — no regression

`npm run dry` reports 34 clones repo-wide (same count as the prior BL-990
pass, which did not touch this file), including 3 self-clones inside
`pipelineBoard.ts` itself (line ranges 505-513/1038-1046,
854-862/1054-1067, 1076-1087/1099-1110) — all sit after line 838, well
outside the pivot's touched hunks (which end at line 812). Pre-existing,
unaffected by this parcel.

## Stryker — deferred, file inside the 3-day cooldown window

`bb swarmforge/scripts/mutation_cooldown_gate.bb <root>
extension/src/concierge/pipelineBoard.ts` -> `DECISION: skip-cooldown`
(file_age_days: 1.74, cooldown: 3 days) — the file is still actively
churning (two bounces, a branch-contamination revert-and-restore, and a
refix all landed on it in the last two days), so BL-149's cooldown gate
correctly defers Stryker regardless of load. Separately, host load was
47-88 on 4 cores throughout this pass (11-22x cores) — squarely in the
office-hours/busy-host bypass range, so even absent the cooldown a full
mutation pass would have been deferred on load grounds alone. Given the
thoroughness of the existing unit/property/acceptance coverage (confirmed
above, not merely trusted) and that this is the file's second hardening
pass in two days, forwarding now rather than stalling the pipeline;
Stryker is owed on the next quiet pass once the cooldown clears.

## Process/fixture hygiene

- `pgrep`/`ps` scoped check: clean, no orphaned processes.
- `git status --short`: clean — only the known pre-existing untracked
  `swarmforge/scripts/test/fixtures/` remains.
- Own scratch (`tmp/bl979-*.log`, `tmp/bl585-work/`, `tmp/bl956-work/`,
  `tmp/bl979-work/`) removed after use.

## Inventory result

**D1..Dn: NONE.** No coverage gap, no correctness defect, no CRAP/DRY
regression. No code changes made — the parcel arrived already thoroughly
reconciled and tested through its bounce/refix/branch-contamination
history.

Forwarding this commit (evidence file committed) to documenter.

By hardender.
