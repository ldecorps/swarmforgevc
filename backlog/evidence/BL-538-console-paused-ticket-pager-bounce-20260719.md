# QA Bounce Evidence: BL-538-console-paused-ticket-pager

1. **Failing command**: `npm test` from `extension/`.
2. **Commit hash**: `2bf7563118d322cf029999e11ea9be29f32916d4`.
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
- Focused BL-538 check passed: `npx vitest run test/pausedPagerBridge.test.js`
  passed 10/10 tests.
- No matching `node --test` or `stryker` orphan was found before/after the run;
  `pgrep -fl 'node --test|stryker'` only matched the shell running the check.
