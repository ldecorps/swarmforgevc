# BL-387 QA bounce — 2026-07-17

## Verdict: BOUNCE — the pipeline-review oracle's setup step is not covered
## by its own error-handling contract; a missing role-prompt file crashes
## the ENTIRE benchmark run instead of degrading that one trial to REJECT

## What was verified correct

- Full unit suite: 317 files / 5108 tests, green.
- Acceptance pipeline: `run_acceptance.sh
  specs/features/BL-387-the-oracle-scores-what-survives-the-pipeline.feature`
  — 6/6 scenarios pass, including all three Scenario Outline rows.
- `runReviewChain`'s stop-on-REJECT / bounce-accumulation logic is genuinely
  unit-tested with scripted verdicts (both branches of the ordered dispatch).
- `runTrial` reads the evaluator from the SAME `scratchDir` the oracle can
  revise, so what is scored is genuinely what the pipeline accepted, not the
  model's first diff — confirmed both by the acceptance step handlers (real
  `runTrial` + real `node:test` evaluator, fixture executor writes a partial
  solution, fixture oracle revises it to the full solution, scored 6/6 not
  4/6) and by reading `runTrial.ts`/`types.ts` directly.
- `createPipelineReviewOracle` is wired into the real CLI entry point
  (`run-role-benchmark.ts:154`), not merely unit-tested in isolation.
- `parseReviewVerdict` correctly treats every unparseable/errored/markerless
  CLI response as REJECT, never a silent ACCEPT, and this is unit-tested.

## The defect

`createPipelineReviewOracle`'s per-stage closure
(`extension/src/benchmark/pipelineReviewOracle.ts:124-137`) reads the
stage's role-prompt file with `fs.readFileSync(rolePromptPath(repoRoot,
stage), 'utf8')` **before** the `try { execFileSync(...) } catch { return
'REJECT'; }` block that wraps only the CLI invocation itself. If that read
throws (the target repo's `swarmforge/roles/<stage>.prompt` does not exist,
or is unreadable), the exception is not caught anywhere in the call chain:
`runReviewChain` (`pipelineReviewOracle.ts:92-107`) does not wrap
`invokeStage`, `runTrial` (`runTrial.ts:50`) does not wrap `deps.oracle.review(...)`,
and `runModel`/`runBenchmark` (`runBenchmark.ts:27,60-63`) push `await
runTrial(...)` straight into the results array with no try/catch anywhere in
the loop. So a single trial's setup failure aborts the entire benchmark run
— every model, every task, every repetition already completed — rather than
being recorded as that one trial not surviving.

This is the same "CLI-FAILURE path must be driven, not just the happy path"
contract `swarmforge/constitution/articles/engineering.prompt` already binds
every test author to (the BL-440 rule), and this file's own sibling boundary
(`ModelExecutor`, `runTrial.ts:25-42`) already follows it correctly: an
execution failure is turned into a `ran:false` trial outcome instead of
being allowed to throw. The new `PipelineOracle` boundary this ticket adds
does not extend the same guarantee to its own setup step, and no test in
`benchmarkPipelineReviewOracle.test.js` exercises this path — every test
either scripts `runReviewChain`'s verdicts directly (never touching
`createPipelineReviewOracle`'s real closure) or short-circuits via
`RUN_ROLE_BENCHMARK_ORACLE_FORCE_RESULT` before the `readFileSync`/
`execFileSync` call is ever reached. Even the `try/catch` that IS present
around `execFileSync` is untested — no test drives a genuinely failing CLI
invocation and confirms it degrades to REJECT rather than propagating.

## Evidence (BL-140 contract)

1. **Failing command** exactly as run, against the merged QA state (built
   from the documenter's handoff):

   ```sh
   cd extension && npm run compile
   node -e "
   const { createPipelineReviewOracle } = require('./out/benchmark/pipelineReviewOracle');
   const os = require('os'), fs = require('fs'), path = require('path');
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvc-oracle-repro-'));
   // dir has no swarmforge/roles/*.prompt - a target repo not yet onboarded,
   // or any repo missing one stage's prompt file
   const oracle = createPipelineReviewOracle(dir, 'sonnet');
   oracle.review(dir, { id: 'task-x' }).then(
     (r) => console.log('RESOLVED (unexpected):', JSON.stringify(r)),
     (e) => console.log('REJECTED with uncaught exception:', e.message)
   );
   "
   ```

2. **Commit hash checked out and tested**: `35fc610b17` (documenter's
   handoff to QA, task `BL-387-the-oracle-scores-what-survives-the-pipeline`).

3. **First error excerpt**:

   ```text
   REJECTED with uncaught exception: ENOENT: no such file or directory, open '/tmp/sfvc-oracle-repro-3JHDE3/swarmforge/roles/cleaner.prompt'
   ```

4. **Failure class**: `behavior` — the oracle's documented degrade-to-REJECT
   contract ("never a silent ACCEPT", per the file's own header comment) is
   incomplete: it covers a bad/erroring CLI response but not a failure to
   even reach the CLI call, and the resulting exception is uncaught all the
   way up through `runBenchmark`'s trial loop.

5. **Expected vs observed**: Expected — a single trial's review-setup
   failure is recorded as that trial not surviving (`{ survived: false,
   bounces: N }`), consistent with how `ModelExecutor` failures are already
   handled in this same file, so one bad trial never loses the rest of a
   long-running, possibly expensive multi-model benchmark. Observed — the
   exception propagates uncaught out of `oracle.review()`, `runTrial()`,
   `runModel()`, and `runBenchmark()`, aborting the whole run.

## Remediation direction (not prescriptive)

Wrap the `fs.readFileSync` role-prompt read in the same failure boundary as
the `execFileSync` call (or move both inside one `try`/`catch` per stage)
so any setup failure — missing/unreadable role-prompt file, or any other
synchronous throw before the CLI is even invoked — degrades that stage to
`REJECT` exactly like a bad CLI response does, and add a test that removes
the fixture's role-prompt file (or otherwise makes the read fail) and
asserts the failure degrades to `REJECT`/`{ survived: false, ... }` rather
than throwing, per the engineering article's CLI-failure-path rule.

By QA.
