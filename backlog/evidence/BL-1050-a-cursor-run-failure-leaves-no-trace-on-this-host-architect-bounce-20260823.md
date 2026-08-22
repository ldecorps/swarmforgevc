# BL-1050 — architect SEND BACK #1: the acceptance scenario for invariant 1's Telegram-independence claim is wired to nothing

**Parcel:** cleaner-forwarded merge commit `9277a60906` (merges coder commit
`da3445b299` into `swarmforge-cleaner`), reviewed after merging into
`swarmforge-architect`.

**Verdict: SEND BACK on one item.** Everything else in this parcel is
correct — see "What is NOT the problem" below. This is not a production
defect: the ticket's first declared invariant ("the log path must not be
reachable only through the code path that also posts") IS correctly
implemented in production code and IS correctly, non-vacuously proven by
`extension/test/cursorBridgeRunLog.property.test.js`'s
`invariant 1: every failure a human can be told about also lands on disk,
post or no post` test, which genuinely simulates a failing post (`onProgress`
throws) with a `reached.postThrew >= 50` reach floor. The gap is narrower:
the ACCEPTANCE-level scenario written specifically to carry this same claim
does not actually exercise it.

## D1 (LOW, acceptance-only) — scenario `cursor-run-failure-log-03`'s Given clause is dead

`specs/pipeline/steps/bl1050CursorRunFailureLogSteps.js:172-177`:

```js
registry.define(/^posting to Telegram fails$/, (ctx) => {
  ctx.topicMessages = [];
  ctx.telegramFails = true;
});
```

`ctx.telegramFails` is set here and **read nowhere else** —
`grep -rn "telegramFails" specs/pipeline/` returns only this one line. The
"When a Cursor run ends with status..." handler used by this scenario
(line 129) always builds its own non-throwing `progressSink:
(l) => ctx.topicMessages.push(l)` and never branches on `ctx.telegramFails`.
So scenario `cursor-run-failure-log-03` ("the record does not depend on
Telegram accepting the post") runs through byte-identical steps to scenario
`cursor-run-failure-log-01`, with the same reason and status — I confirmed
this by reading the step wiring, not by assumption. `node specs/pipeline/cli.js
specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature`
shows both passing (8/8), which is expected either way: nothing currently
depends on the Given actually doing anything.

This scenario is the acceptance-level encoding of the ticket's first
declared invariant. As currently wired it provides zero additional coverage
beyond scenario 01 — a regression that made the log write depend on a
successful Telegram post (the exact bug this ticket closes) would not be
caught by this scenario, only by the property test.

**Remediation:** wire the Given to the same mechanism the coder already used
correctly in the property test (`cursorBridgeRunLog.property.test.js`'s
`postThrows` → `onProgress` that throws). Concretely, in
`bl1050CursorRunFailureLogSteps.js`, make the "When a Cursor run ends with
status..." handler branch on `ctx.telegramFails`, e.g.:

```js
const progressSink = ctx.telegramFails
  ? () => { throw new Error('telegram post failed'); }
  : (l) => ctx.topicMessages.push(l);
await runAgainstRealLog(ctx, { status: sdkStatus, reason, progressSink });
```

(`runAgainstRealLog` already forwards `progressSink` as `onProgress` to
`SESSION.runCursorAgentPrompt`, and `runCursorAgentPrompt`/
`assertCursorRunSucceeded` already write the log line before any exception
reaches a caller — so this should just make the existing green scenario
green for the right reason, not require a production change.)

## What is NOT the problem — do not change these

- `extension/src/bridge/cursorBridgeRunLog.ts` — new module, both invariants
  correctly implemented (log-before-throw ordering; name-pattern env-secret
  redaction with a stated, tested length floor).
- `extension/src/bridge/cursorBridgeAgentSession.ts` — `assertCursorRunSucceeded`
  logs unconditionally before either throw branch; the logged `reset` decision
  uses `shouldResetCursorAgentSession(detail)` on the SAME raw SDK detail the
  `promptAgent` recovery path later derives its own decision from (verified:
  the quota-rewrite throw's wrapped message does not change the reset
  predicate's answer for that branch, and the non-quota throw's wrapped
  message still contains the raw detail as a substring, so `.includes()`-based
  predicates agree either way).
- `extension/test/cursorBridgeRunLog.test.js`,
  `extension/test/cursorBridgeAgentSession.test.js`'s BL-1050 additions,
  `extension/test/cursorBridgeRunLog.property.test.js` — all correct,
  non-vacuous, good reach-floor discipline on the property test (rewritten
  branch, reset branch, failed-post branch, secret-length boundary all
  asserted reached, not hoped for).
- `specs/pipeline/steps/index.js` registration of `bl1050CursorRunFailureLogSteps`
  — present (`required_wiring` satisfied).
- No change needed to `telegramCursorBridgeLive.ts` (untouched, correctly —
  the ticket explicitly excludes changing Telegram-facing wording, and no
  caller of `runCursorAgentPrompt` exists outside `cursorBridgeAgentSession.ts`
  itself).

## Gates run this pass

- `cd extension && npm install && npm run compile` — clean; confirmed fresh
  (`out/bridge/cursorBridgeRunLog.js` exports match source, mtimes current).
- `node out/tools/dependency-gate.js src/bridge/cursorBridgeAgentSession.ts
  src/bridge/cursorBridgeRunLog.ts` (run from `extension/`) — **PASSED, no
  forbidden edges.**
- `node out/tools/dependency-gate.js` (full-repo, no args) — 3 pre-existing
  `acyclic` violations among `telegram-front-desk-bot.ts` /
  `telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`,
  confirmed unchanged by this parcel (`git diff d439aaab2 9277a60906 --
  <those 3 files>` is empty; last touched by BL-1036) — pre-existing baseline
  debt, not this ticket's.
- `node out/tools/co-change-report.js src/bridge/cursorBridgeAgentSession.ts
  src/bridge/cursorBridgeRunLog.ts` — flags historical coupling with
  `telegramCursorBridgeLive.ts`/`telegramCursorBridgeCore.ts` (expected,
  pre-existing; the ticket deliberately does not touch the Telegram-posting
  layer) and cursorBridgeRunLog.ts's own sibling test/step files (expected,
  new module).
- `npx vitest run test/cursorBridgeRunLog.test.js test/cursorBridgeAgentSession.test.js`
  — 69/69 pass.
- `npx vitest run --config vitest.properties.config.mjs test/cursorBridgeRunLog.property.test.js`
  — 6/6 pass.
- `node specs/pipeline/cli.js specs/features/BL-1050-a-cursor-run-failure-leaves-no-trace-on-this-host.feature`
  — 8/8 pass (expected; D1 is a coverage gap, not a currently-failing
  scenario).
- Forwarded-lineage check — `9277a60906`'s second parent `da3445b299` (coder's
  BL-1050 commit) is present; ancestry intact.

---

*Architect bounce #1 on BL-1050. Recorded via `record-bounce.js --by architect`.*
