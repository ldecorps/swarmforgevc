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
now sits between the measured durations and the guard's pass/fail verdict.

**Amended the same day (2026-09-16, QA bounce):** the first cut refused a
`stale-row` outright, but QA's own three `npm test` runs 2.5 hours after
the register's numbers were measured already showed three registered
files drifted under 80% of budget and one unregistered file drifted to
9.0s — a snapshot register that *refuses* on ordinary run-to-run jitter is
red on day one, the same wall-clock jitter BL-445 already documented.
Only `new-pole` and `unowned-row` fail the exit code now; `watch` and
`stale-row` are surfaced, never silently absorbed and never blocking:

| Situation | Verdict | Blocks the run? |
| --- | --- | --- |
| File with no register row, at or above `PER_FILE_DURATION_BUDGET_MS × NEW_POLE_REFUSAL_FRACTION` (7000 × 1.5 = 10500 ms), confirmed over budget alone | `new-pole` | Yes |
| File with no register row, between the budget and that 1.5× line | `watch` | No — named in the report every time it occurs |
| Row present, owner ticket open, file still over budget | `ok` (reported as a registered pole) | No |
| Row's owner ticket is not open (paused/active) | `unowned-row` | Yes |
| Row's file now measures under 80% of budget | `stale-row` | No — reported so the row can be drained, never blocking |

**Amended again (2026-09-18, BL-1633):** a would-be `new-pole` is no longer
refused on its in-suite reading alone. `checkFileDurationBudget` gains an
optional `confirmAlone` argument (`recordTestDuration.js` wires in
`confirmPoleAlone`, one real solo `vitest` run under the same project
config `npm test` itself uses); before refusing, every unregistered
candidate at or above the 1.5× line is measured alone once. Under budget
alone, it is reported as contention (both durations shown, the run
passes); at or over budget alone — or the confirmer times out and returns
`null`, which counts as over budget alone — it stays a `new-pole`, refused
exactly as before. No confirmation runs for a registered or below-the-line
file, and each candidate is confirmed at most once per run. This is why
`extension/test/telegramFrontDeskBotCli.test.js` — whose in-suite duration
kept crossing the line non-deterministically (8.0–19.7 s in-suite vs.
3.7–5.0 s solo, six of eight runs over) even after BL-1620's subprocess
cut — no longer needs a register row at all: the confirmation mechanism
now contains the risk the row existed to guard against, and BL-1633
removed its row in the same land.

`PER_FILE_DURATION_BUDGET_MS` itself is unchanged (7000 ms); no test is
deleted, skipped or excluded to satisfy the gate.

| Want | Do |
| --- | --- |
| Land work while a known-slow file is on file | Keep its row in `backlog/suite-poles.tsv`, owner ticket open |
| A file you didn't touch crosses 1.5× budget | Mint or point to an owning ticket and add a row — do not silence it |
| A file you didn't touch drifts between budget and 1.5× | Nothing blocks; it's named as `watch` — a candidate for BL-791 slice D's inventory, not an emergency |
| You cut a pole's runtime below 80% of budget | Remove its row in the SAME land — a lingering `stale-row` never blocks but should not sit forever |
| The owning ticket closes without the pole being cut | The row becomes `unowned-row` and blocks until re-owned or the file is actually fixed |

## The recorded trend gains verdict fields (BL-1598)

`testDurationRecorderLib.js`'s `buildRecord` (the row `recordTestDuration.js`
appends to `.test-durations.jsonl`, BL-078) keeps `result` as the TEST
outcome (pass/fail of the tests themselves, unchanged and independent of
the budget verdict) and adds five fields computed from the same per-file
durations the guard already extracts:

- `pole_ms` — the single slowest file's duration in the run.
- `work_ms` — the summed per-file duration across the run.
- `new_offenders` — count of files at or above the 1.5× refusal line with
  no register row.
- `watch_files` — count of unregistered files over budget but under the
  1.5× line.
- `budget_verdict` — `ok` / `watch` / `stale-row` / `unowned-row` /
  `new-pole`, the guard's own headline verdict for the run (that priority
  order: a `new-pole` or `unowned-row` anywhere wins over `watch`, which
  wins over `stale-row`, which wins over `ok`).

`npm test`'s exit code is the TEST suite's exit code; when the tests
themselves pass but the budget guard doesn't (only `new-pole`/`unowned-row`
do that), the guard's non-zero exit code is what `computeFinalExitCode`
returns. A run can therefore show `result: pass` and `budget_verdict:
new-pole` in the same recorded row — this is what lets the trend (and the
briefing's suite-duration line, `swarmMetrics.ts`) tell a failing test
apart from a slow file going forward, which it could not do while every
row read `result: fail`.

## Verify

```bash
cd extension
npm test                                    # exit code is the TEST exit code
node ../specs/pipeline/scripts/run_acceptance.sh \
  ../specs/features/BL-1598-the-unit-suite-pole-register-makes-the-per-file-gate-green.feature
```

Scratch-copy check against the real `.vitest-report.json`: append a
synthetic register row for a file that measures well under budget — it
reports `stale-row`, naming the file, exit 0; remove a real row for a file
still over budget — `new-pole`, refused; a scratch report with an
unregistered file at 9000 ms (between budget and 1.5×) — `watch`, named,
exit 0.

Related: [BL-1007 unit lane contention budget](BL-1007-a-unit-lane-budget-is-relative-to-recorded-contention.md).
BL-1600 gave `bl1277UnscopedStepCollisionGuard.test.js` — one of the nine
files this register lists — BL-1007's contention-relative per-test timeout
for its own load-dependent wall time; that is orthogonal to this register,
whose row for the same file still tracks its measured pole against the
fixed 7000 ms per-file budget.

## BL-791 slice D, first cut: cutting a pole vs. re-owning its row (BL-1620/BL-1633)

Not every listed file gets faster from a test-side change alone, and a
file's solo time is not what the gate reads. Two shapes turned up in the
first slice D cut, `extension/test/telegramFrontDeskBotCli.test.js`:

- **A real cost inside the test, cut with an injected side effect.** Ten
  of the file's slowest cases each started one or two real `bb
  swarm_handoff.bb` processes (~1.3 s each) through `enqueueRoleAnswerNote`
  — a real subprocess start, unreachable from the test side alone. BL-1620
  gave that function one optional trailing `runHandoff` parameter — the
  file's own `postFn` convention, never a `*_FORCE_RESULT` env bypass —
  defaulting to the exact real spawn every production caller still gets;
  the affected cases now inject a fake that records the call and resolves,
  reading the same on-disk draft file and role-answer pointer they asserted
  against before. The one test that proves the real script's own
  refusal/delivery contract (BL-1518) keeps the real `bb` call on purpose.
  This is the pattern for any future slice D file whose pole is a real
  subprocess or I/O call inside the test, not the production code under
  test: solo duration dropped from 22.9 s to 4.2–5.96 s across measured
  runs, test count only rising (275 → 276, a hardening-pass addition).
- **A row that survives its own cut.** The gate reads a file's **in-suite**
  duration (10-11 concurrent forks under `npm test`), not its solo run.
  Even after the cut above, `telegramFrontDeskBotCli.test.js` measured
  7.79–19.7 s in-suite across measured runs against 4.2–5.96 s solo — most
  of them still over the 1.5× refusal line's fixed-budget shadow. Cutting a
  pole's *solo* time below budget does not by itself let its row leave: a
  row only drains once the guard, run against the file's actual **in-suite**
  duration, reports `stale-row` for it (the fixed 80%-of-budget threshold
  in the table above, measured the same way the gate measures) — or, as of
  BL-1633, once the gate itself stops trusting the in-suite reading alone
  and confirms a suspected new pole against its own solo measurement first
  (see the "Amended again" note above). `telegramFrontDeskBotCli.test.js`'s
  row left `backlog/suite-poles.tsv` in BL-1633's own land: its solo time,
  already under budget after BL-1620's cut, now passes the confirmation
  the gate performs before it would otherwise refuse.
