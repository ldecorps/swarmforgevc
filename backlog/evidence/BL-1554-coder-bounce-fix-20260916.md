# BL-1554 — coder fix for architect bounce D1, 2026-09-16

## The bounce

`backlog/evidence/BL-1554-architect-bounce-20260916.md` (commit reviewed:
merge of cleaner e21b362f67 into architect), blamed coder. D1: the
register check's stdout was captured through the same `tailExcerpt`
bounding (`EXCERPT_MAX_CHARS` = 4000) as every other check's
display-only `excerpt`, then `composeQaGatherReport` fed that SAME
bounded string to `JSON.parse` for the register join. Once the register
CLI's real JSON output exceeds 4000 characters, `tailExcerpt` slices off
the opening `{`/array structure (it keeps the TAIL), `JSON.parse` throws,
the exception is swallowed, and every failing file the run found is
silently reported `absent` regardless of what the register actually
says. Reproduced by the architect directly (40 register rows, ~4640
chars) against `composeQaGatherReport`: an owned row surfaced as
`absent`.

## The fix

`runChecklist` gains an optional 4th parameter, `onRawOutcome?: (id,
outcome) => void`, called with the check's UNBOUNDED `RunOutcome` right
before (never instead of) building the bounded `CheckRow.excerpt` - only
for a check that actually ran (never for one blocked, either by its own
missing prerequisite or by the runner failing to start it). Existing
callers (`runChecklist(CHECKLIST, ctx, runFn)`, 3-arg) are unaffected -
the parameter is optional and every prior call site keeps its old
signature.

`composeQaGatherReport` passes a callback that captures the register
check's raw `outcome.stdout` into a local variable, and
`parseRegisterOutput` now takes that raw string as an explicit parameter
instead of reading `row.excerpt` - the register check's row still carries
its own bounded `excerpt` for human display (unchanged report shape,
unchanged `EXCERPT_MAX_CHARS`), but the JSON the register join actually
parses is never truncated regardless of register size.

Not a re-run of the register CLI (the architect's own alternative #2):
still exactly one `runFn` call per checklist entry, preserving the
"sequential, exactly once" invariant unchanged.

## Verification

- `extension/test/qaGather.test.js` gains two tests:
  1. `runChecklist calls onRawOutcome with the UNBOUNDED outcome for a
     check that ran, never for a blocked one` - a 5000-char fake stdout,
     asserting the callback fires with the full 5000 chars (not the
     bounded 4000) for every check that ran, and never fires for
     `wiring`/`acceptance` when both are blocked by a missing
     prerequisite.
  2. `composeQaGatherReport correctly classifies owned even when the
     register CLI's own JSON exceeds the display excerpt bound` -
     reproduces the architect's own repro verbatim (40 rows, asserted
     `registerJson.length > 4000` so the fixture actually crosses the
     bound) and asserts the failing file joins as `owned`, not `absent`.
- **Non-vacuity, proven by hand**: reverted `parseRegisterOutput`'s call
  site back to reading the bounded `excerpt` (the pre-fix shape); the new
  regression test failed immediately with `"join": "absent"` instead of
  `"join": "owned"` - the exact defect. Restored and reconfirmed.
- `npx vitest run test/qaGather.test.js test/qaGatherCli.test.js` — 21/21
  (was 19/19; +2 new).
- `npx vitest run test/qaGather.property.test.js --config
  vitest.properties.config.mjs` — 1/1, unaffected (the property test
  drives `runChecklist` with its existing 3-arg call; `onRawOutcome` being
  optional means no change was needed there).
- `./specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1554-*.feature` — 9/9.
- `tsc --noEmit` clean; `bl759CursorOperatorFrontDeskCycle.property.test.js`
  (full-repo dependency gate) green - `src/quality/qaGather.ts` still
  imports no fs/child_process, the fix stays entirely inside the existing
  pure/impure split.

By coder.
