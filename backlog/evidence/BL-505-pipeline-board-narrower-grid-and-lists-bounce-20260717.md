# BL-505 QA bounce evidence — 2026-07-17

## 1. Failing command
```
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-455-pipeline-board-epic-grouping-parked-slug.feature
```
Exit code: `1` (4 of 8 scenarios fail).

## 2. Commit hash tested
`5b5c53505c` — QA's merge of the documenter's `git_handoff` for BL-505 (`4fd738ce`,
"Document BL-505: pipeline board grid/lists narrower for a phone").

## 3. First error excerpt
```
# Subtest: A ticket in a given state appears in exactly one place on the board [1]
not ok 2 - A ticket in a given state appears in exactly one place on the board [1]
  error: `Scenario "A ticket in a given state appears in exactly one place on the board" failed
  at step "Then ticket "BL-387" appears in the "stage grid"": Cannot read properties of
  undefined (reading 'length')`
  code: 'ERR_TEST_FAILURE'
  stack: |-
    runScenario (specs/pipeline/runtime.js:30:13)
    ...
# tests 8
# pass 4
# fail 4
```
Root cause (confirmed by a temporary stack-trace instrumentation of `runtime.js`, reverted
after diagnosis — `git diff -- specs/pipeline/runtime.js` is empty): the crash is inside
`specs/pipeline/steps/bl455PipelineBoardSteps.js`'s own local `lastRendered` (line 124-132):

```js
function lastRendered(fixture) {
  if (fixture.edited.length > 0) {   // <-- fixture.edited is undefined
    ...
```

The `ctx.fixture` this is called with is built by **`bl452PipelineBoardSteps.js`'s**
`fakeConciergeAdapters()` (the `"ticket \"<id>\" is \"<state>\""` Given step lives there and
sets `ctx.fixture` for both files' scenarios to share). `BL-470` ("remove dead BL-452
edit-in-place acceptance step handlers", commit `b419322b`, 2026-07-17 00:46) deleted the
always-empty `edited` field from `bl452PipelineBoardSteps.js`'s fixture and updated *that
file's own* `lastRendered` to match — but never touched `bl455PipelineBoardSteps.js`'s
separate, duplicate `lastRendered`, which still reads `fixture.edited.length`. BL-470's own
commit message says "BL-452's acceptance run stays 4/4" — it verified only BL-452's feature,
never BL-455's, so the cross-file breakage went uncaught for one full ticket cycle.

BL-505's own parcel then edited this exact file (`bl455PipelineBoardSteps.js`) — its diff
touches the sibling functions `idInGrid`/`idInParkedList` a few lines above the broken
`lastRendered` — without running BL-455's own acceptance suite to notice the pre-existing
crash, even though the ticket's own QA E2E procedure (step 4) explicitly says: "Confirm the
full acceptance suite (including the revised BL-455/462/465 scenarios) passes."

## 4. Failure class
`acceptance` — the crash is inside the acceptance test's own step-glue (a stale fixture-field
reference), not a compile error, not a unit-test failure, and not a behavior mismatch in the
shipped product code (`extension/src/concierge/pipelineBoard.ts` itself looks correct; BL-490
and BL-505's own feature files both pass in full).

## 5. Expected vs observed
Expected: BL-455's own 8 acceptance scenarios stay green after BL-505 touches
`bl455PipelineBoardSteps.js`, per the ticket's own step-4 QA procedure. Observed: 4 of 8 fail
(`pipeline-board-epic-02`'s 3 Examples plus `pipeline-board-epic-03`) with
`Cannot read properties of undefined (reading 'length')`, because the file's own
`lastRendered` was never repaired to match BL-470's fixture-shape change.
