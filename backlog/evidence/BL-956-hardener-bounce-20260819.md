# BL-956 hardener bounce — 2026-08-19

## Process note (not itself an item — context for why this pass went deeper than usual)
Neither the cleaner nor the architect wrote a dedicated pass-evidence file
for this parcel this time (`bb8cad57d0` is a bare "Merge cleaner BL-956
into architect" with no separate architect commit, unlike every other
ticket this session). Given severity `high`, a genuine outage-prevention
invariant (invariant 1, 2026-07-17 class), and no prior written review to
build on, I ran a full independent pass rather than trusting the merge
alone — that pass is what surfaced D1 below.

## Checks run (complete inventory, not first-failure-stop)

1. **Independent re-run of all touched test files**: `npx vitest run
   --coverage pipelineBoard` — 176/176 pass (`pipelineBoard.test.js` 123,
   `pipelineBoardSync.test.js` 32, `pipelineBoardPinSync.test.js` 21).
   `test/conciergeTick.test.js` — 111/111, confirmed untouched (out of
   scope, must not regress — didn't). Property test
   (`bl956PipelineBoardCaptionCapInvariants.property.test.js`) — 3/3.
   Acceptance (`specs/features/BL-956-...feature`) — 6/6.
2. **CRAP**: `renderParkedSectionHtml` reports complexity=12,
   **coverage=92%** (not 100%, unlike its plain-text sibling
   `renderParkedSection` at complexity=11/100%) — a live signal correlated
   with D1 below: the function was never given the branch the fix needs,
   so its own coverage sits short of its sibling's. The rest of the
   file's high-CRAP functions are pre-existing debt, not newly introduced
   or worsened by this parcel's own diff (spot-checked `buildPipelineBoardHtml`/
   `composePipelineBoardHtml`/`renderListSectionHtml` against
   `git diff 294d46406a^ 294d46406a` — none of their CRAP-relevant branch
   structure changed; only call-site additions did).
3. **DRY**: `npx jscpd src/concierge/pipelineBoard.ts` flags a clone
   between `renderParkedSection` (lines ~756-762) and
   `renderParkedSectionHtml` (~964-967) — corroborating evidence for D1,
   not a separate item: the two functions are near-duplicates that were
   supposed to stay in lockstep, and D1 is exactly the place they didn't.
4. **Required wiring**: `bl956PipelineBoardCaptionCapSteps` confirmed
   registered in `specs/pipeline/steps/index.js`.
5. **Own correctness read, then live reproduction** (this is where D1 was
   found): read `gridCaptionLine`/`truncateCaptionDescription`
   (invariant 1 + 2, both correctly wired and shared by both render
   paths) and `buildCollapsedEpicEntries`/`formatCollapsedEpicLine`/
   `pipelineBoardEpicsOverflowLine` (invariant 3). Confirmed the PLAIN-TEXT
   path (`renderPipelineBoardBody` → `renderParkedSection`, used only for
   `pipelineBoardSync.ts`'s change-detection CONTENT SIGNATURE — its own
   header comment says so explicitly) correctly wires
   `collapsedEpicsOmittedCount` into an `epicsOverflowLine` parameter. The
   LIVE HTML path (`composePipelineBoardHtml` → `buildPipelineBoardHtml`
   → `renderParkedSectionHtml`, confirmed via `pipelineBoardSync.ts`'s own
   comment as "the live adapter sends this as the message body with
   parse_mode HTML") never computes an epics-overflow value at all —
   `renderParkedSectionHtml`'s signature has no such parameter, unlike its
   plain-text sibling.

## D1 — invariant 3 is violated in the actual live-shipped Telegram message; every test that verifies it checks the wrong render function

**Class**: `behavior` (a concrete, live-reproduced correctness defect) —
per this constitution's own standing rule (BL-333 precedent, restated
across this session's other reviews) that a defect spotted during review
is a send-back even when the parcel otherwise reads clean.

**Where**: `extension/src/concierge/pipelineBoard.ts` —
`renderParkedSectionHtml` (~line 958) and its one caller,
`buildPipelineBoardHtml` (~line 1037, specifically the `parkedOverflow`
computation at ~1047-1048, which has no epics-overflow sibling).

**Reproduced live, not assumed**: built a real board via
`computePipelineBoard` with 5 epic-tracker paused items
(`type: 'epic'`) against `PIPELINE_BOARD_COLLAPSED_EPICS_MAX = 3`:

```
collapsedEpics.length: 3
collapsedEpicsOmittedCount: 2
composePipelineBoardHtml(...).html contains "more epics"?  FALSE
renderPipelineBoardBody(data) contains "more epics"?       TRUE
```

Separately confirmed the OTHER two caps (`more parked`, `more active`)
correctly appear in the live HTML with a similarly-constructed fixture —
this is not a systemic HTML-rendering gap, it is isolated to the
collapsed-epics cap specifically.

**Why every existing test missed it**: grepped every place this ticket's
own tests assert `/more epics/` — `pipelineBoard.test.js:1321` and
`bl956PipelineBoardCaptionCapInvariants.property.test.js:138` — both call
`renderPipelineBoardBody(data)`, the plain-text CONTENT-SIGNATURE
function `pipelineBoardSync.ts` uses only for change detection
(confirmed by that file's own header comment), never what is actually
posted. Not one test in this parcel calls `composePipelineBoardHtml` (or
`buildPipelineBoardHtml`) and asserts on the epics-overflow line —
**confirmed for the acceptance suite too**, not just hypothesized: in
`bl956PipelineBoardCaptionCapSteps.js`, `ctx.composed` (the HTML result
from `composePipelineBoardHtml`) is read ONLY by the message-length
assertion (invariant 1, lines 239-240); every overflow-line assertion,
including the epics one, reads `ctx.body` (`renderPipelineBoardBody`,
line 60). All three test layers — unit, property, acceptance — share the
identical blind spot.

**Impact**: with more than `PIPELINE_BOARD_COLLAPSED_EPICS_MAX` (3) epic
trackers paused, the human sees exactly 3 collapsed-epic lines in the
real board message with NO indication that any were omitted — silently
contradicting the ticket's own invariant 3 ("every cap on this board is
visible, never silent... which is the one shape this file's own comments
forbid") in the one surface that matters, while the entire test suite
reports green.

**Remediation** (direction, not mandate — implementation is the coder's
call, this is not mine to fix as hardener): give `renderParkedSectionHtml`
an `epicsOverflowLine?: string` parameter mirroring `renderParkedSection`'s
own shape, compute it in `buildPipelineBoardHtml` the same way
`parkedOverflow` is already computed (`(data.collapsedEpicsOmittedCount ??
0) > 0 ? pipelineBoardEpicsOverflowLine(...) : undefined`), thread it
through, and render it escaped (`escapeHtml(...)`, matching how
`overflowLine` is already escaped in that function). Add a REAL unit or
acceptance assertion that drives `composePipelineBoardHtml` (not
`renderPipelineBoardBody`) with a dropped-epics fixture and checks the
resulting `.html` for the overflow line — the gap here is exactly that no
test exercises the live path for this invariant, so the fix must add one,
not just make the code correct.

## Everything else in this parcel is clean

Items 1-4 above (all suites green, required wiring present, CRAP/DRY
findings limited to pre-existing debt and the one item above). D1 is the
only item in this inventory.

By hardener.
