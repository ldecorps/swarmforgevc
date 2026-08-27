# BL-1050-a — architect review of merge `56032cc11e`: required_wiring violation found, root-caused to an architect-side merge drop, and fixed in-worktree (no bounce)

**Parcel:** cleaner-forwarded merge commit `56032cc11e` (merges coder commit
`64edafda63` into `swarmforge-cleaner`), reviewed after merging into
`swarmforge-architect`.

## CORRECTION (see `record-bounce-correction.js`, filed against this file/commit)

This file originally recorded a SEND BACK to `coder`, reasoning that coder's
send-back-#1 fix commit `64edafda6` restored six of BL-1050's seven touched
files but forgot the seventh — the `specs/pipeline/steps/index.js`
registration. **That attribution was wrong.** `git show
64edafda6:specs/pipeline/steps/index.js` (and every ancestor of it on the
coder/cleaner lineage back through `da3445b29`, the ticket's original
submission) DOES carry the registration line. The coder's own branch was
correct throughout.

The line was missing only on `swarmforge-architect` — dropped by an EARLIER
architect merge, `c00b5c256` ("Merge cleaner work for
BL-777-barge-in-detector-and-playback-abort (758a94db6a) into
swarmforge-architect"), made in a prior session before this one started (it
was already the branch tip when this review began). Root cause, traced by
inspecting `specs/pipeline/steps/index.js` at every relevant commit:

- `merge-base(af07ac2ba, 758a94db6)` = `9277a60906`, which has BOTH
  `bl713CursorSeatDriverSteps` (no trailing comma, last entry) AND
  `bl1050CursorRunFailureLogSteps` (added by the original BL-1050 submission,
  now the new last entry).
- Side A, `af07ac2ba` (my own send-back-#1 revert): removed the
  `bl1050...` line entirely, correctly reverting `bl713...` back to being the
  last entry (no trailing comma) — this was the INTENDED effect of that
  revert.
- Side B, `758a94db6` (cleaner's BL-777 lineage, which had not yet picked up
  my revert): unchanged from the merge-base on `bl713`/`bl1050`, EXCEPT it
  added a trailing comma to the `bl1050...` line because BL-777's own
  registration (`bl777BargeInDetectorSteps`) was appended after it.
- Both sides therefore touched the same three-line region (one deleting,
  one appending after it) without git flagging a conflict, and the merge
  that produced `c00b5c256` kept only side A's deletion — silently dropping
  the `bl1050` registration that side B still carried correctly. Every file
  BOTH sides touched was checked (`git diff c00b5c256 af07ac2ba --stat` /
  `git diff c00b5c256 758a94db6 --stat`, per the BL-571/958 "diff every
  merge against both parents and read the deletions" rule) — the `index.js`
  registration is the ONLY content lost; nothing else from BL-777's merge
  was dropped.

So: my own send-back-#1 revert was correct at the time. The genuinely new
defect is that a LATER, unrelated architect merge (BL-777's) silently
re-dropped content the coder had since correctly restored, because git's
merge algorithm attributed the whole hunk to the side that had touched it
most recently (mine) rather than surfacing a conflict. This is an
architect-branch integration defect, not a coder defect — bouncing it to
coder would have sent them content they already have correctly, for a
problem that lives entirely on this branch.

**Resolution:** fixed directly in this worktree (restoring one line whose
content, position, and correctness were already established by the coder's
reviewed commit — not new authorship) rather than bounced. See "Fix Applied"
below. `record-bounce-correction.js` filed against the send-back this file
originally recorded (ticket `BL-1050`, commit `56032cc11e`) so the metrics
store stops counting it against `coder`.

## D1 (as found) — `bl1050CursorRunFailureLogSteps` was never required into the step registry on this branch

`specs/pipeline/steps/index.js`'s `DOMAINS` array, as merged into
`swarmforge-architect`, ended `...bl713CursorSeatDriverSteps,
bl777BargeInDetectorSteps` — no `bl1050` entry anywhere in the file. This is
exactly the failure mode the ticket's own `required_wiring` field names:
*"the new step handler must be registered in the step registry -
specs/pipeline/runtime.js THROWS on any scenario with no handler, so an
unregistered file fails every scenario in this ticket's feature file rather
than silently skipping them."* Running it proved it:

```
$ node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature
error: 'Scenario "...": no step handler matched "Given a Cursor Remote bridge running under its supervisor"'
# tests 8
# pass 0
# fail 8
```

0/8, not the 8/8 the coder's commit message reports for its own (correct,
on its own branch) state — the acceptance gap only exists once merged onto
`swarmforge-architect`.

## Fix Applied

Restored the single line, in the same position, as it exists in the
coder's own reviewed commit `64edafda6`:

```diff
   require('./bl713CursorSeatDriverSteps'),
+  require('./bl1050CursorRunFailureLogSteps'),
   require('./bl777BargeInDetectorSteps')
```

Re-ran the acceptance feature file — **8/8 pass**:

```
$ node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature
# tests 8
# pass 8
# fail 0
```

## What is NOT the problem — do not change these

- The send-back #1 remediation itself: `ctx.telegramFails` now genuinely
  drives a throwing progress sink, and the coder additionally found and
  fixed a real production gap while chasing it — the stub event needed to be
  one `summarizeSdkProgressLine` actually renders (`tool_call`, not a bare
  `assistant` message) for the post to fire at all, and once it fired, a
  throwing progress post used to abort the stream loop before `run.wait()`
  / `assertCursorRunSucceeded` ever ran, so NOTHING reached the log despite
  the caller still reporting a failure. `reportSdkProgress` now catches and
  swallows a progress-post failure (logged under its own
  `CURSOR_PROGRESS_POST_FAILURE_MARKER`, never counted as a run failure).
  This is in-scope: it is what invariant 1 actually requires, not scope
  creep.
- `extension/src/bridge/cursorBridgeRunLog.ts`, `cursorBridgeAgentSession.ts`
  — both declared invariants correctly implemented.
- Property-test coverage of both declared invariants —
  `cursorBridgeRunLog.property.test.js` genuinely drives real runs through
  `runCursorAgentPrompt` with a throwing `onProgress`, asserts the post was
  attempted (not just armed), and clears BL-654's reach-floor bar for every
  drawn branch (quota/reset/plain reasons, failed posts, exact-boundary and
  one-below secret lengths). Non-vacuous, re-verified this pass: 6/6 green.
- `extension/test/cursorBridgeRunLog.test.js`,
  `cursorBridgeAgentSession.test.js`'s BL-1050 additions — correct.
- Dependency-rule gate, changed files only: **PASSED, no forbidden edges.**
- Dependency-rule gate, full repo: 3 pre-existing `acyclic` violations among
  `telegram-front-desk-bot.ts` / `telegramCursorOperatorExec.ts` /
  `telegramCursorOperatorLiveness.ts` — confirmed untouched by this parcel
  (not in the diff), pre-existing baseline debt (last touched by BL-1036),
  same as send-back #1's finding.
- Co-change report on the two changed bridge files — coupling with
  `telegramCursorBridgeCore.ts`/`telegramCursorBridgeLive.ts` and sibling
  test/step files, expected and pre-existing; no new coupling.
- Full extension unit suite: `npx vitest run` — **8492/8492 pass**.

## Gates run this pass

- `cd extension && npm install && npm run compile` — clean.
- `node out/tools/dependency-gate.js src/bridge/cursorBridgeAgentSession.ts src/bridge/cursorBridgeRunLog.ts` — PASSED.
- `node out/tools/dependency-gate.js` (full-repo) — 3 pre-existing violations, confirmed unrelated to this parcel.
- `node out/tools/co-change-report.js src/bridge/cursorBridgeAgentSession.ts src/bridge/cursorBridgeRunLog.ts` — informational, no unexpected coupling.
- `npx vitest run test/cursorBridgeRunLog.test.js test/cursorBridgeAgentSession.test.js` — 77/77 pass.
- `npx vitest run --config vitest.properties.config.mjs test/cursorBridgeRunLog.property.test.js` — 6/6 pass.
- `npx vitest run` (full extension suite) — 8492/8492 pass.
- `node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature` — **0/8 before the fix, 8/8 after.**
- Forwarded-lineage check — `56032cc11e`'s ancestry includes `af07ac2ba`
  (my prior revert) and `64edafda6` (coder's send-back #1 fix); ancestry
  intact.
- `git diff c00b5c256 af07ac2ba --stat` / `git diff c00b5c256 758a94db6 --stat`
  — confirmed the `index.js` registration is the only content the c00b5c256
  merge dropped relative to either parent; no other silent drop found.

## Disposition

No bounce. Forwarded to `hardender` per the normal COMPLIANT path, carrying
this fix as part of the architect's own commit on `swarmforge-architect`.

---

*Corrected — no bounce charged. See `record-bounce-correction.js --ticket BL-1050 --commit 56032cc11e`.*
