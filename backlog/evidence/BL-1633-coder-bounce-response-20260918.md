# BL-1633 — coder, response to cleaner's bounce, 2026-09-18

Bounce: `backlog/evidence/BL-1633-bounce-cleaner-20260918.md` (commit
`0378dbfce1`). Two findings, D1 and D2; both addressed here.

## D1 — BL-1006 retirement (done)

`specs/features/BL-1620-two-unit-lane-poles-come-under-the-per-file-budget.feature`:
deleted the `# BL-1620 two-unit-lane-poles-02` comment, `Scenario:`, and
its five `Given`/`And`/`When`/`Then` lines; re-tensed the narrative
clause ("register row stays, re-owned by BL-1633 ...") to the past
("register row stayed, re-owned by BL-1633, until BL-1633 retired it
..."), dropping the now-meaningless "BL-1633 retires scenario 02 below
then" self-reference.

`specs/pipeline/steps/bl1620TwoUnitLanePolesSteps.js`: deleted the five
`scoped(...)` registrations scenario 02 owned (`backlog/suite-poles.tsv
names the file under BL-1633`, the in-suite-duration Given, the guard-run
When, the no-new-pole/no-unowned-row Then, the row-stays Then), and the
`readInSuiteMeasuredMs` helper and `FILE`/`REGISTER_OWNER` constants that
existed only to serve them (now dead). The Background step and scenarios
01/03 are untouched, per the ticket's own "How".

## D2 — merged the regex fix (done, cherry-picked)

`main` did not yet carry `7e74a9e2eb` ("align the Background step regex
with the specifier's ticket-free wording") at the time of this bounce -
BL-1620 itself was still in flight (hardener → documenter → QA, not yet
landed on `main`). Rather than wait further (this parcel was already
bounced once over this exact dependency), cherry-picked `7e74a9e2eb`
directly from `swarmforge-QA` (the one file it touches, already reviewed
and landed on BL-1620's own branch) so the retirement above is built
against the CURRENT Background wording, not a stale one.

Re-ran `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`
after both D1 and D2: 2/2 green (scenarios 01, 03 — exactly what the
bounce asked for). BL-1633's own feature: still 5/5 green, unaffected.

## A second real bug, caught the same way as the first

A fresh `npm test` after D1/D2 (626 files, 10690 tests, 0 failed)
reported `emitLifecycleSnapshotCli.test.js` as a new-pole offender AGAIN
— the same class of failure the parcel's own first bug produced, but a
DIFFERENT cause: a manual, isolated `confirmPoleAlone` call for the same
file, run seconds later, measured 6.4s (well under budget) and a replay
of the guard against the SAME stored report, run in a fresh process,
correctly classified it as contention. The confirmation only failed when
it ran LIVE, nested inside the already-running `npm test` process,
immediately after the main suite's own 10-fork run finished.

Root cause: `confirmPoleAlone`'s `spawnSync` call did not set `stdio`,
so Node buffered the nested vitest process's stdout/stderr under the
default 1MB `maxBuffer`. Right after the main suite's own heavy run, the
nested confirmation's own startup output was enough to exceed it,
`spawnSync` set `result.error` (`ERR_CHILD_PROCESS_STDIO_MAXBUFFER`), and
`confirmPoleAlone` returned `null` — which the FIRM treats as "over
budget alone", silently reproducing the exact refusal this ticket exists
to prevent, for a reason unrelated to the file's real duration in either
direction. Fixed by setting `stdio: 'ignore'`: the confirmation only ever
reads the JSON report FILE, never the child's console output, so there
is no reason to capture it at all — this removes the failure mode
entirely rather than raising the cap (which would only move the same
ceiling).

Verified: two consecutive full `npm test` runs after the fix (626 files,
10690 tests, 0 failed each) both printed `suite file budget OK`, with
`emitLifecycleSnapshotCli.test.js` and `telegramFrontDeskBotCli.test.js`
both correctly reported as contention, not new-pole, in both runs.

## Re-verified after both fixes

- `npx vitest run test/checkSuiteFileBudgetCli.test.js` — 59/59 green
  (unaffected — the stdio fix is JS-only, in `recordTestDuration.js`,
  outside this test file's scope).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1633-*.feature`
  — 5/5 green.
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`
  — 2/2 green (01, 03).
- `npm test` — three runs total after this bounce (one before the stdio
  fix, reproducing the bug; two after, both clean).

By coder.
