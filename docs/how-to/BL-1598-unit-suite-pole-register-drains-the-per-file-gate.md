# The unit suite's per-file budget gate reads a pole register (BL-1598)

*How-to. Task-oriented: land work while a known-slow test file is on file,
and drain the register once a pole is cut.*

## The gap

BL-378's per-file guard (`extension/src/tools/check-suite-file-budget.ts`,
wired into `extension/scripts/recordTestDuration.js`) hard-fails `npm
test` when any file's measured duration crosses `PER_FILE_DURATION_BUDGET_MS`
(7000 ms). With no way to tell a known, owned offender apart from a fresh
regression, the gate had live offenders continuously since 2026-08 (19 on
2026-08-22, 9 on 2026-09-16) — every run recorded `result: fail`, so a new
pole was indistinguishable from an old one and the gate stopped nothing.

## What changed

A committed register, `backlog/suite-poles.tsv` (same shape as the
standing-red register, BL-1428: tab-separated `file`, `owner` ticket,
`first_seen`, `measured_ms`, `note`; `#`-comment and blank lines skipped),
now sits between the measured durations and the guard's pass/fail verdict:

| Situation | Verdict | Blocks the run? |
| --- | --- | --- |
| File over budget, no register row | `new-pole` | Yes — same as before BL-1598 |
| File over budget, row present, owner ticket open, not stale | `ok` (reported) | No |
| Row's owner ticket is not open (paused/active) | `unowned-row` | Yes |
| Row's file now measures under 80% of budget | `stale-row` | Yes — the row must leave |

`PER_FILE_DURATION_BUDGET_MS` itself is unchanged (7000 ms); no test is
deleted, skipped or excluded to satisfy the gate.

| Want | Do |
| --- | --- |
| Land work while a known-slow file is on file | Keep its row in `backlog/suite-poles.tsv`, owner ticket open |
| A file you didn't touch is now a new offender | Mint or point to an owning ticket and add a row — do not silence it |
| You cut a pole's runtime below 80% of budget | Remove its row in the SAME land — a stale row still blocks |
| The owning ticket closes without the pole being cut | The row becomes `unowned-row` and blocks until re-owned or the file is actually fixed |

## The recorded trend gains verdict fields (BL-1598)

`testDurationRecorderLib.js`'s `buildRecord` (the row `recordTestDuration.js`
appends to `.test-durations.jsonl`, BL-078) keeps `result` as the TEST
outcome (pass/fail of the tests themselves, unchanged and independent of
the budget verdict) and adds four fields computed from the same per-file
durations the guard already extracts:

- `pole_ms` — the single slowest file's duration in the run.
- `work_ms` — the summed per-file duration across the run.
- `new_offenders` — count of files over budget with no register row.
- `budget_verdict` — `ok` / `new-pole` / `stale-row` / `unowned-row`, the
  guard's own verdict for the run.

`npm test`'s exit code is the TEST suite's exit code; when the tests
themselves pass but the budget guard doesn't, the guard's non-zero exit
code is what `computeFinalExitCode` returns. A run can therefore show
`result: pass` and `budget_verdict: new-pole` in the same recorded row —
this is what lets the trend (and the briefing's suite-duration line,
`swarmMetrics.ts`) tell a failing test apart from a slow file going
forward, which it could not do while every row read `result: fail`.

## Verify

```bash
cd extension
npm test                                    # exit code is the TEST exit code
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-1598-the-unit-suite-pole-register-makes-the-per-file-gate-green.feature
```

Scratch-copy check: append a synthetic register row for a file that
measures well under budget and re-run the guard against the same
`.vitest-report.json` — the row refuses as `stale-row`, naming the file;
remove a real row for a file still over budget — it refuses as `new-pole`.

Related: [BL-1007 unit lane contention budget](BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.md).
BL-1600 gave `bl1277UnscopedStepCollisionGuard.test.js` — one of the nine
files this register lists — BL-1007's contention-relative per-test timeout
for its own load-dependent wall time; that is orthogonal to this register,
whose row for the same file still tracks its measured pole against the
fixed 7000 ms per-file budget.
