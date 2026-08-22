# BL-1050-a — architect SEND BACK #2: the send-back fix restored six of the "seven" files, not the seventh — the step registration itself

**Parcel:** cleaner-forwarded merge commit `56032cc11e` (merges coder commit
`64edafda63` into `swarmforge-cleaner`), reviewed after merging into
`swarmforge-architect`.

**Verdict: SEND BACK on one item.** The production and test content is
correct and thorough — see "What is NOT the problem" below. The parcel is
DOA at the acceptance gate for a mechanical reason: the step handler file is
never required into the registry, so `required_wiring` is violated and every
scenario in the ticket's own feature file fails.

## D1 (send-back #1 fix restored 6 of 7 files, not the step registration)

The prior bounce (`BL-1050-a-...-architect-bounce-20260823.md`, send-back
#1) was recorded against merge `9277a60906`. My revert of that bounce
(`af07ac2ba`) removed BL-1050's content from **7** files, including a
one-line addition to `specs/pipeline/steps/index.js`:

```diff
-  require('./bl713CursorSeatDriverSteps')
+  require('./bl713CursorSeatDriverSteps'),
+  require('./bl1050CursorRunFailureLogSteps')
```

(that hunk reverted, i.e. the require line removed, restoring the file to
its pre-BL-1050 state — confirmed via `git show af07ac2ba -- specs/pipeline/steps/index.js`).

Commit `64edafda6` ("BL-1050 send-back #1: wire scenario 03's dead Given,
and the gap it was hiding") says in its own message: "The architect's own
revert took BL-1050's seven files back out of the branch, so this parcel
restores them from the reviewed tip 9277a60906 ... and then applies the fix
on top." But its diff touches only **6** files:

```
extension/src/bridge/cursorBridgeAgentSession.ts
extension/src/bridge/cursorBridgeRunLog.ts
extension/test/cursorBridgeAgentSession.test.js
extension/test/cursorBridgeRunLog.property.test.js
extension/test/cursorBridgeRunLog.test.js
specs/pipeline/steps/bl1050CursorRunFailureLogSteps.js
```

`specs/pipeline/steps/index.js` is not among them. Confirmed on the merged
tip in this worktree:

```
$ grep -n "bl1050\|CursorRunFailureLog" specs/pipeline/steps/index.js
(no output)
```

The `DOMAINS` array ends `...bl713CursorSeatDriverSteps` — no `bl1050`
entry anywhere in the file.

This is exactly the failure mode the ticket's own `required_wiring` field
names: *"the new step handler must be registered in the step registry -
specs/pipeline/runtime.js THROWS on any scenario with no handler, so an
unregistered file fails every scenario in this ticket's feature file rather
than silently skipping them."* Running it proves it:

```
$ node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature
...
error: 'Scenario "...": no step handler matched "Given a Cursor Remote bridge running under its supervisor"'
...
# tests 8
# pass 0
# fail 8
```

0/8, not the 8/8 the commit message reports — every scenario fails on the
very first Background step, because `registerSteps` in
`bl1050CursorRunFailureLogSteps.js` is never called.

**Remediation:** in `specs/pipeline/steps/index.js`, restore the require
line coder's original commit `da3445b29` added:

```diff
-  require('./bl713CursorSeatDriverSteps')
+  require('./bl713CursorSeatDriverSteps'),
+  require('./bl1050CursorRunFailureLogSteps')
```

(placement doesn't matter — the array isn't alphabetically ordered — only
that the module is required somewhere in `DOMAINS`.) After adding it, rerun
`node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature`
and confirm 8/8.

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
  — both declared invariants correctly implemented; unchanged from send-back
  #1's clean bill except the new best-effort progress-post handling above.
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
- Full extension unit suite: `npx vitest run` — **8492/8492 pass**, matching
  the commit message's claim (the acceptance-level claim of 8/8 in the same
  message is the only thing wrong here).

## Gates run this pass

- `cd extension && npm install && npm run compile` — clean.
- `node out/tools/dependency-gate.js src/bridge/cursorBridgeAgentSession.ts src/bridge/cursorBridgeRunLog.ts` — PASSED.
- `node out/tools/dependency-gate.js` (full-repo) — 3 pre-existing violations, confirmed unrelated to this parcel.
- `node out/tools/co-change-report.js src/bridge/cursorBridgeAgentSession.ts src/bridge/cursorBridgeRunLog.ts` — informational, no unexpected coupling.
- `npx vitest run test/cursorBridgeRunLog.test.js test/cursorBridgeAgentSession.test.js` — 77/77 pass.
- `npx vitest run --config vitest.properties.config.mjs test/cursorBridgeRunLog.property.test.js` — 6/6 pass.
- `npx vitest run` (full extension suite) — 8492/8492 pass.
- `node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature` — **0/8 pass, 8/8 fail** (this is the send-back).
- Forwarded-lineage check — `56032cc11e`'s ancestry includes `af07ac2ba`
  (my prior revert) and `64edafda6` (coder's send-back #1 fix); ancestry
  intact.

---

*Architect bounce #2 on BL-1050-a. Recorded via `record-bounce.js --by architect`.*
