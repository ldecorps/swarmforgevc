# QA Bounce Evidence: BL-508-pipeline-board-updated-at-uk-time

1. **Failing command**: `npm test` from `extension/`.
2. **Commit hash**: `696ff5158f389fa37c90b51bfaf47cf466411c4a`.
3. **First error excerpt**:

```text
FAIL  test/paneTailerClass.test.js > poll reports a dead session and fires onDead once, then revives it
AssertionError: Expected values to be strictly equal:

0 !== 1

- Expected
+ Received

- 1
+ 0

test/paneTailerClass.test.js:102:12
  100|     tailer.stop(clearTick);
  101|
  102|     assert.equal(updates.length, 1);
       |            ^
  103|     assert.match(updates[0].text, /is not running/);
```

4. **Failure class**: `unit`.
5. **Expected vs observed**: expected the full unit suite to pass; observed
   `npm test` fail with 10 failures across 5 test files
   (`paneTailerClass`, `paneTailerPollResilience`, `paneTailerScrollback`,
   `tmpDirMigrationGuard`, and `traceHopMain`).

Additional QA context:
- Focused BL-508 unit checks passed:
  `npm run compile && npx vitest run test/pipelineBoard.test.js test/pipelineBoardSync.test.js test/conciergeTick.test.js`
  passed 237/237 tests.
- BL-508 acceptance passed:
  `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-508-pipeline-board-updated-at-uk-time.feature`
  passed all 3 examples.
- No matching `node --test` or `stryker` orphan was found after the run;
  `pgrep -fl 'node --test|stryker'` only matched the shell running the check.
