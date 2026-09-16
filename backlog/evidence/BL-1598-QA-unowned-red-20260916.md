# BL-1598 — QA unowned-red hold, 2026-09-16

`qa-gather.js` (BL-1554) at parcel commit 771b9cdd6d ran the full unit and
property lanes; three files timed out, none related to BL-1598's own
diff (`extension/src/tools/check-suite-file-budget.ts`,
`extension/scripts/recordTestDuration.js`,
`extension/scripts/testDurationRecorderLib.js`, `backlog/suite-poles.tsv`)
and none carry a register row (`register_join`: all three `"absent"`).

Failing command: `npm test` (unit lane, `extension/`)
Commit: 771b9cdd6d

```
FAIL  test/bl1277UnscopedStepCollisionGuard.test.js > BL-1277 unscoped step-pattern collision guard > the shipped step files register no colliding unscoped pattern
Error: Test timed out in 20000ms.
```

Failing command: `npm run test:properties` (property lane, `extension/`)
Commit: 771b9cdd6d

```
FAIL  test/bl1304DryRunSpawnsNothing.property.test.js > invariant 1: dry run starts no stage and creates no worktree/branch, regardless of prior state
Error: Test timed out in 20000ms.

FAIL  test/bl968MaterializedGuardSensitivity.property.test.js > BL-968 invariant 2 (generative): every planted load-time-binding module, any class, any chain depth, turns the guard red naming it
Error: Test timed out in 240000ms.
```

All three reproduce green solo at the same commit (`npx vitest run
test/bl1277UnscopedStepCollisionGuard.test.js` — 6/6 green, 7.9s;
`npx vitest run --config vitest.properties.config.mjs
test/bl1304DryRunSpawnsNothing.property.test.js` — 3/3 green, 8.7s) —
same class as BL-1588/BL-1592/BL-1601's full-lane concurrency-load
timeouts, not a correctness defect.

`grep -rl "bl1277UnscopedStepCollisionGuard\|bl1304DryRunSpawnsNothing\|bl968MaterializedGuardSensitivity" backlog/paused backlog/active`
finds only the BL-791 epic and BL-1598's own ticket (contextual mentions,
not ownership). No open ticket names these three files' full-lane
timeouts.

Failure class: `unit`/`property` (full-lane load contention). Expected:
green. Observed: `Test timed out` under full-lane concurrency, green
solo.

BL-1598's own scope is otherwise clean: acceptance 12/12, required_wiring
exercised, standing-red register `"unowned":[]` for all 12 rows it
already owns, own-diff files unchanged by these three failures. Holding
only on these three unrelated full-lane timeouts per Article 4.2.

By QA.
