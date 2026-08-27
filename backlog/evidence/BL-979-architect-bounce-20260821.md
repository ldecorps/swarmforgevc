# BL-979 — architect review, bounce to coder

- **Reviewer**: architect, 2026-08-21.
- **Reviewed at**: cleaner tip `f9377ad27a` (merged into architect at `701176a8d`).

## Checklist run (complete review inventory, Article 4.4)

| Check | Result |
|---|---|
| Dependency-rule gate (`extension/out/tools/dependency-gate.js`, scoped to the parcel's changed `extension/src`+`extension/test` files) | PASSED — no forbidden edges |
| Co-change coupling (`extension/out/tools/co-change-report.js pipelineBoard.ts`) | `conciergeTick.ts`/`pipelineBoardSync.ts` flagged (16/11 co-changes); verified the public exports `renderPipelineBoard`/`renderPipelineBoardBody`/`composePipelineBoardHtml`/`PIPELINE_BOARD_MESSAGE_MAX_LENGTH` those two files import are byte-for-byte unchanged in the diff — coupling is real but this parcel's change stays behind the contract, so no source-side action needed |
| Invariant 1 + 2 (declared, `backlog/active/BL-979...yaml`) | Both encoded in ONE property test (`extension/test/pipelineBoard.property.test.js:279`), constructed reachability floors (over/under budget, 4 id widths, 3 epic mixes, all ≥30 hits). Independently re-proven non-vacuous by me: broke `maxVisibleGridRows` to ignore the budget → property fails (`13 !== 12` on the row-count assert) → reverted, re-ran green |
| Property coverage of touched pure modules beyond declared invariants | `pipelineBoard.ts` is the only touched pure module; its property coverage is exactly the invariants above plus the pre-existing BL-502/505/506/507 properties (untouched, still green). Nothing further needed |
| BL-979 acceptance (`specs/features/BL-979-...feature`) | 10/10, run directly via `node specs/pipeline/cli.js` |
| BL-585 acceptance (post-retirement) | 8/8 |
| BL-956 acceptance (post-retirement) | 5/5 |
| BL-979 + BL-585 + BL-956 retirements (sc01/03/04 of BL-585, sc03 of BL-956) | Each checked against its stated successor in BL-979's own feature file (sc01→BL-979 sc01, sc03(epic caption)→BL-979 sc02/03, sc04(width dropper)→BL-979 sc05, BL-956 sc03(adjacency grouping)→BL-979 sc02) — genuinely superseded, no live check deleted |
| `extension/test/pipelineBoard.test.js` + `bl979PipelineBoardTicketRows.test.js` | 141/141 |
| **`extension/test/conciergeTick.test.js`** | **2/150 FAILING — see D1** |
| `pipelineBoardSync.test.js`, `runOneConciergeTick.test.js`, `conciergeTickScheduler.test.js`, `conciergeTickRequest.test.js`, `residentPaneSpy.test.js`, `pipelineBoardPinSync.test.js`, `telegramFrontDeskBotCli.test.js` (every other consumer of `pipelineBoard.ts`'s exports) | All green |
| Repo-wide grep for the same stale-header assertion shape (`matrix header`, `header.*carr`) outside the touched files | Only the two D1 sites match |

## D1 (behavior, coder) — two standing pre-pivot reds left in `conciergeTick.test.js`

The ticket's own `constraints:` are explicit: *"Unit AND acceptance are updated
in the SAME parcel - BL-949 is the standing lesson that a layout change
leaves stale asserts behind otherwise. No standing 'pre-pivot' reds."*
`pipelineBoard.test.js` was faithfully re-expressed for the axis pivot
(BL-949 discipline followed correctly there), but `conciergeTick.test.js` —
which also renders through `renderPipelineBoardBody`/`renderPipelineBoardGridOnly`
and pins the pre-pivot "the matrix header carries the active ticket id(s)"
shape — was never touched, and now fails against this parcel's own
production code:

- `test/conciergeTick.test.js:2199` — *"BL-455: role-held tickets are joined
  to their backlog item epic/title..."* — asserts `expected the matrix header
  to carry both active ids`. Post-pivot the header carries the 8 stage
  glyphs; the ids are the ROW gutter now.
- `test/conciergeTick.test.js:2436` — *"BL-473: a ticket physically in
  backlog/active/ that no role holds still renders, in the not-started
  state"* — same stale header-carries-id assertion.

**Verified not pre-existing**: swapped the parcel's `pipelineBoard.ts` back
to its pre-BL-979 content (main-merge-base `794d812b0`) with
`conciergeTick.test.js` unchanged → both tests pass, 111/111. Swapped the
parcel's actual `pipelineBoard.ts` back in → the same two fail, nothing
else changes. The regression is caused by this parcel leaving this file
un-updated, not by anything upstream.

**Remediation**: re-express both assertions for the row-per-ticket shape —
same discipline already used for the 12 sites re-expressed in
`pipelineBoard.test.js` (e.g. assert the ticket's ROW carries its id in the
gutter and the correct stage mark, not that the header carries the id).
Re-run the full `conciergeTick.test.js` file after, not just these two
tests — sibling assertions later in the same two tests may share the same
fixture output.

## Clean sweep otherwise

No architecture-boundary violation (module stays within the pure/testable
`extension/src/concierge/` core, no I/O, no vscode API, no webview
storage), no invariant violation, no other correctness defect found on a
full read of the diff.
