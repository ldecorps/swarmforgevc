# BL-340-run-role-benchmark-main-untested-in-process bounce evidence (QA, 2026-07-14)

This is a RECURRENCE of the same defect already bounced once on this ticket
(`backlog/evidence/BL-340-role-benchmark-harness-slice-1-bounce-20260714.md`,
citing commit `09e6a5e470`/`da812efe12`). The coder's send-back did not fix it;
the architect's PASS (`b971c825`,
`backlog/evidence/BL-340-run-role-benchmark-main-untested-in-process-20260714-architect.md`)
verified the wrong thing and forwarded it anyway.

1. **Failing command**: `grep -n "main" extension/test/runRoleBenchmarkCli.test.js`
   (run from repo root against the merged worktree), cross-checked with
   `grep -rln "run-role-benchmark" extension/test/ specs/pipeline/steps/`.

2. **Commit hash**: `52461cb0e8` (hardener's "BL-340: hardening pass — Gherkin
   acceptance mutation, CRAP/DRY verified, no survivors"), which carries
   `da812efe12` (coder's "BL-340: run-role-benchmark's main() orchestration is
   now testable" — the SAME commit object cited in the original bounce) as an
   ancestor. No new coder commit touches
   `extension/test/runRoleBenchmarkCli.test.js` or
   `extension/src/tools/run-role-benchmark.ts` anywhere in this cycle
   (`git log --oneline --all -- extension/test/runRoleBenchmarkCli.test.js`
   shows only `da812efe` and the original `8fb0b982`).

3. **First error excerpt** (absence, not a red test — a coverage gap):
   ```
   $ grep -n "main" extension/test/runRoleBenchmarkCli.test.js
   34://    so main()'s own orchestration is coverage-visible, the engineering
   35://    article's CLI main()-thin-wrapper rule) ──────────────────────────
   (only comment references; `main` itself is never imported or called)

   $ grep -n "require" extension/test/runRoleBenchmarkCli.test.js
   5:const { parseArgs, reportDateKey, runRoleBenchmarkCli } = require('../out/tools/run-role-benchmark');
   ```
   `run-role-benchmark.ts` exports `main` as
   `makeArgsGuardedMain(parseArgs, USAGE, (args) => runRoleBenchmarkCli(args, defaultDeps()))`.
   The coder's fix extracted `runRoleBenchmarkCli(args, deps)` as an injectable-deps
   function and added a real test for it — genuine progress, and worth keeping —
   but that is the THIN-WRAPPER half of the rule (logic pushed into a tested,
   exported function). `main` itself, and `defaultDeps()` (which wires the REAL
   `createClaudeCliExecutor()`/`createNodeTestQualityEvaluator()`, real
   `mkScratchRoot`/`nowIso`, and the real write+commit path), are still never
   imported or invoked by any test — in-process or subprocess — anywhere in
   `extension/test/` or `specs/pipeline/steps/`
   (`roleBenchmarkHarnessSteps.js` still drives `runBenchmark`/`reportArtifact`
   directly, bypassing `run-role-benchmark.ts` entirely, unchanged from the
   original bounce).

4. **Failure class**: `unit` (missing coverage of a real, live production code
   path — not a red test).

5. **Expected vs observed**: expected — per the original bounce and per
   `engineering.prompt`'s CLI main() rule — that `main()` itself (its arg-guard
   failure/usage-print path, and the `run(args)` call into
   `runRoleBenchmarkCli(args, defaultDeps())` with the REAL deps) be exercised
   by an in-process test, mirroring `notifyDeadLettersCli.test.js`:
   `const { main } = require('../out/tools/run-role-benchmark')`, then
   `process.chdir(<fixture root>)` into a real fixture, `await main()` directly
   (with `process.argv` set to the fixture's args), capture stdout, restore the
   previous cwd/argv in a `finally` — keeping the subprocess smoke test (if one
   exists) alongside it as the wiring lock, never as the substitute. Observed:
   only `runRoleBenchmarkCli` (the extracted orchestration, called with
   hand-injected fakes) is tested; `main` and `defaultDeps()` remain at 0%
   in-process coverage, CRAP unmeasured on those branches, mutants free to
   survive undetected on the arg-guard path and the real-deps wiring. This is
   the exact gap named in the first bounce, restated — not a new defect — and
   is (per `engineering.prompt`'s own running count of BL-233/BL-262/BL-272/
   BL-350) the **5th occurrence** of this defect class, now actually landing
   uncaught past the architect instead of being stopped there.

## Process note, not part of the evidence proper

The architect's PASS (`b971c825`) reasoned that moving `main()`'s orchestration
into `runRoleBenchmarkCli(args, deps)` and testing that function satisfied "the
same thin-`main()`, push-logic-into-a-testable-function split
`recruiter-run.ts`/`bakeoff-run.ts` already established" — but per
`engineering.prompt`: *"Thin is not the same as covered: `main()` itself must
be CALLED IN-PROCESS by a test, not only spawned as a subprocess."* Extracting
and testing the helper is necessary but not sufficient; the second half of the
rule (call `main()` itself) was never checked before the PASS verdict.

Left for the coder: add a test to `extension/test/runRoleBenchmarkCli.test.js`
(or a sibling) that imports `main` from `../out/tools/run-role-benchmark` and
calls it directly in-process against a real fixture dir + a small models-file
fixture, following `notifyDeadLettersCli.test.js`'s
`process.chdir`/`await main()`/capture-stdout/restore-cwd(and argv)-in-`finally`
pattern — faking only the genuinely external boundary (the model executor /
evaluator can be swapped via a seam, or the run can point at the same fixture
`roleBenchmarkHarnessSteps.js` already uses so nothing calls a real `claude`
CLI or makes a real git commit in the test). Keep the existing `parseArgs` and
`runRoleBenchmarkCli` tests as-is — they are correct and still needed, just not
sufficient on their own.
