# BL-340 bounce evidence (QA, 2026-07-14)

1. **Failing command**: `grep -n "main" extension/test/runRoleBenchmarkCli.test.js` (run from
   `extension/`), cross-checked with `grep -rln "require.*run-role-benchmark" extension/test/
   specs/pipeline/` from the repo root.

2. **Commit hash**: `09e6a5e470` (documenter's "Document BL-340: role-benchmark harness slice 1"),
   which carries `da812efe12` (coder's "BL-340: run-role-benchmark's main() orchestration is now
   testable") as an ancestor.

3. **First error excerpt** (absence, not a red test — this is a coverage gap, not a failing
   assertion):
   ```
   $ grep -n "main" extension/test/runRoleBenchmarkCli.test.js
   NO MATCH: main is never referenced in this test file

   $ grep -rln "require.*run-role-benchmark" extension/test/ specs/pipeline/
   extension/test/runRoleBenchmarkCli.test.js
   ```
   `runRoleBenchmarkCli.test.js` imports only `parseArgs` from `extension/src/tools/
   run-role-benchmark.ts` and asserts on it. `extension/src/tools/run-role-benchmark.ts`'s
   exported `main` (a `makeArgsGuardedMain(parseArgs, USAGE, async (args) => {...})` closure that
   reads the models file from disk, `fs.mkdtempSync`s a scratch dir, wires the REAL
   `createClaudeCliExecutor()`/`createNodeTestQualityEvaluator()` production adapters, and calls
   `writeBenchmarkReport`/`commitBenchmarkReport`) is never imported or invoked — in-process or as
   a subprocess — by any test file under `extension/test/` or any acceptance step under
   `specs/pipeline/steps/` (`roleBenchmarkHarnessSteps.js` drives `runBenchmark`/`reportArtifact`
   directly, bypassing `run-role-benchmark.ts` entirely).

4. **Failure class**: `unit` (missing coverage of a real, live production code path — not a red
   test).

5. **Expected vs observed**: expected `main()`'s own wiring branches (arg-guard failure/usage-print
   path, models-file read, scratch-dir creation, the real-executor/real-evaluator wiring, the
   write+commit+print call sequence) to be exercised by an in-process test, per
   `engineering.prompt`'s CLI main() rule: *"main() itself must be CALLED IN-PROCESS by a test, not
   only spawned as a subprocess... test main() the way notifyDeadLettersCli.test.js already does:
   process.chdir(<fixture root>) into a real fixture, await main() directly, capture stdout, restore
   the previous cwd in a finally — and keep the subprocess smoke test alongside it as the wiring
   lock, never as the substitute."* That rule is tracked as a recurring, named defect class —
   BL-233, BL-262, BL-272, then BL-350's `sample-resources.ts main()` — and was written specifically
   because a thin `main()` still keeps enough of its own branches that a subprocess-only or
   delegate-only proof leaves it at 0% in-process coverage, CRAP unmeasured, mutants free to survive
   undetected. Observed: `da812efe12`'s own commit message claims *"run-role-benchmark's main()
   orchestration is now testable"*, but only delivered the THIN-WRAPPER half of the rule
   (`parseArgs` extracted and unit-tested) — the SECOND, in-process-call half was never added. This
   would be the 5th occurrence of the exact pattern the rule exists to stop.

Also note (not part of this bounce, context only): this ticket shipped bundled inside BL-355's
cleaner/architect handoffs (rode through under BL-355's task name, per the documenter's own commit
message), so it never received hardener's own dedicated hardening pass — the stage that has caught
every one of this defect class's first 4 occurrences. That's very likely why this 5th one wasn't
caught before reaching QA.

Left for the coder: add `extension/test/runRoleBenchmarkCli.test.js` coverage that calls `main()`
directly in-process against a real fixture dir + a small models-file fixture (mirroring
`notifyDeadLettersCli.test.js`'s `process.chdir` / `await main()` / capture-stdout / restore-cwd-in-
finally pattern), faking only the genuinely external boundary (the model executor / evaluator, or
run against the same fixture `roleBenchmarkHarnessSteps.js` already uses) — keep the existing
`parseArgs` unit tests as-is, they are correct and still needed.
