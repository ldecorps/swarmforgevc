# BL-1598 — architect review pass, bounce, 2026-09-16

Commit reviewed: 32fb5fd439 (Merge cleaner a385a9a881 into architect).

Checklist run: dependency-gate (`node out/tools/dependency-gate.js` on the
three touched source files) PASSED, no forbidden edges. Co-change report
against the same files showed only expected sibling/test coupling, no
new suspicious pairing. Declared invariant 1 (property test,
`bl1598SuitePoleRegister.property.test.js`) is present, non-vacuous
(break-then-fix confirmed in its own header comment), and passes.
Declared invariant 2 (file-count, non-encodable per BL-654) is recorded
with a stated reason. `formatGuardReport`/`checkFileDurationBudget`
production code (check-suite-file-budget.ts) itself correctly implements
the 2026-09-16 15:10Z amendment (NEW_POLE_REFUSAL_FRACTION=1.5, stale-row
and watch both report-never-refuse). One defect found; the full pass is
this single item.

## D1

- **Failing command**: `npx vitest run test/checkSuiteFileBudgetCli.test.js` (from `extension/`)
- **Commit hash**: 32fb5fd439
- **First error excerpt**: `Test Files 1 failed | 1 passed (2)` / `Tests 11 failed | 43 passed (54)` — e.g. `AssertionError: Expected values to be strictly equal: true !== false` (stale-row test) and `TypeError: Cannot read properties of undefined (reading 'length') at check-suite-file-budget.ts:275` (formatGuardReport tests)
- **Failure class**: behavior
- **Expected vs observed**: `npm test` in `extension/` is expected to exit on the real test outcome; observed is a genuinely RED unit file on this parcel's own commit — not a pre-existing, previously-ticketed red (grepped `backlog/` for `checkSuiteFileBudgetCli` and `check-suite-file-budget`: only this ticket's own evidence files reference them).
- **Blamed role**: coder
- **Remediation pointer**: see root cause below — consolidate the test file, never drop the hardener's register/verdict coverage, re-verify against the amended production code.

### Root cause

The coder's rebuild commit (`backlog/evidence/BL-1598-coder-rebuild-20260916.md`,
"rewrote the three exact-shape assertions... 15 tests, all green") replaced
`checkSuiteFileBudgetCli.test.js` with a 15-test file that imports only
`main, extractFileDurations, checkFileDurationBudget, formatBudgetOffenders,
PER_FILE_DURATION_BUDGET_MS, NEW_POLE_REFUSAL_FRACTION` — it drops ALL unit
coverage of `parseRegisterRows`, `openTicketIds`, `runGuardAgainstReport`,
`formatGuardReport`, and `printGuardReport`. That is exactly the
register/verdict logic the hardener's own earlier pass
(`backlog/evidence/BL-1598-hardender-20260916.md`) added 33 tests for, to
close a scoped-Stryker gap of 42 survived + 83 no-coverage mutants (and to
bring `checkFileDurationBudget`'s CRAP from 12 to under 6 via the
`classifyRegisterRow`/`classifyRegisterRows` extraction).

When the rebuild was merged forward into architect's tree (which still
carried the hardener's full 43-test file, pre-amendment), the merge (done
by a prior session before this one started) combined the rebuild's 15
amended tests with the hardener-era file's remaining 30 tests for the
functions the rebuild's imports had dropped, rather than reconciling them
— producing the current 45-test, 658-line file. The 30 carried-over tests
still assert PRE-amendment behavior and are now wrong or crash:

1. `a row whose file now measures under 80% of budget is a stale-row
   refusal` — asserts `passed: false`; the amendment states stale-row is
   reported, never refused.
2. `verdict priority: new-pole beats unowned-row and stale-row when
   several kinds occur together` — its "new-pole" fixture measures
   9000ms, which is below the 1.5x=10500ms threshold and now classifies
   as `watch`, so `unowned-row` wins the run instead of `new-pole`.
3–6. Four `formatGuardReport: ...` tests — their literal
   `BudgetCheckResult` fixtures omit the (amendment-added) `watchFiles`
   field entirely, so `formatGuardReport` throws
   `TypeError: Cannot read properties of undefined (reading 'length')`
   at `check-suite-file-budget.ts:275`.
7–9. Three `printGuardReport ...` tests — same missing-`watchFiles` crash,
   via `formatGuardReport`.
10–11. `runGuardAgainstReport with no register path ...` /
   `...register path whose file does not exist yet ...` — both use a
   bare 9000ms fixture expecting `new-pole`; it is now `watch`.

Production code (`check-suite-file-budget.ts`) itself is correct per the
amendment throughout — this is a test-file defect only, but it leaves the
real `npm test` lane red on this parcel's own commit, and separately it
threatens to reopen the hardener's already-closed mutation gate (99% of
the dropped tests are exactly the ones Stryker needed).

### Remediation

Rewrite `checkSuiteFileBudgetCli.test.js` as ONE consolidated file: keep
the rebuild's amended assertions (1.5x threshold, watch band, stale-row
reports-never-refuses) AND restore full, amendment-updated coverage of
`parseRegisterRows`, `openTicketIds`, `runGuardAgainstReport`,
`formatGuardReport`, and `printGuardReport` — every fixture that predates
the amendment (bare-breach-is-new-pole, stale-row-refuses,
missing-`watchFiles`) needs updating, not deleting outright, since the
underlying function coverage is still required. Re-run the scoped Stryker
config (`extension/vitest.bl1598.stryker.config.mjs`) to confirm the
199/204-killed mutation result the hardener recorded is not regressed by
the rebuild's narrower test file, then `npm test` clean from `extension/`.

Not routed to cleaner separately: per Article 4.4, a defect blamed on an
earlier stage travels in one inventory to the earliest blamed role — the
coder's rebuild dropping the coverage is the root cause; the merge
reconciliation and the cleaner's recorded `NONE` (which did not actually
run this test file) are downstream of that same commit.

By architect.
