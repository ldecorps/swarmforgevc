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
passes); at or over budget alone it stays a `new-pole`, refused exactly as
before. No confirmation runs for a registered or below-the-line file.

**Amended again (2026-09-24, BL-1721):** the confirmation no longer
returns a bare number-or-`null`. `confirmPoleAlone` now returns `{ms}` on
a real solo measurement, or `{failed: reason}` — naming the spawn error,
the timeout, a missing report, or no entry for the file — never a
silent `null` a caller cannot report on. A `failed` outcome is retried
**once**; if the retry also fails, the file still refuses as a `new-pole`
(BL-1633's fail-closed posture is unchanged — two failed attempts still
count as over budget), but the offender line now names what actually
happened rather than only the in-suite duration: `(confirmation failed:
<first reason>; retry failed: <second reason>)`, or `(confirmed alone:
<Ns>, still over budget)` for a real over-budget measurement. This closed
the gap QA hit at load ~10 (2026-09-24): a per-file budget refusal for two
files whose confirm-alone measurements on `main` the same hour were 16 ms
and 4.2 s — the refusal printed only the in-suite number, so a slow
confirmation and a failed one read identically. This is why
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
| A pole will never be cut (the cost IS the point of the test) | Give its row an `accepted` disposition instead of an owner that would have to stay open forever — see below |

## A pole that will never be cut needs no open owner (BL-1629)

Not every registered file is necessarily heading toward a fix. The
motivating case, `extension/test/bl968StepRegistryMaterializedTreeGuard.test.js`,
spawns two full step-registry loads on purpose — BL-968 invariant 1 — and
at the time this ticket was minted one load alone cost 12.6 s of require
time across 1189 handlers, with no cut in sight that would bring it under
the 7000 ms budget without weakening the test it exists to be. Under the
owned-only model above, the only way to keep such a row from refusing as
`unowned-row` the day its "owning" ticket closed was a ticket that never
closes — which is not what an owner ticket means anywhere else in this
register. (**Amended 2026-10-06, same parcel:** BL-1630 landed in the
meantime and brought bl968 under 80% of budget — 2.57 s alone, 4.1–4.4 s in
the lane — so its own row was retired rather than accepted; see below.)

The register's row shape gains an optional 5th column, `disposition`,
between `measured_ms` and `note`: `file`, `ticket`, `first_seen`,
`measured_ms`, `[disposition]`, `note`. A row with no 5th column (every
row before this ticket, and any new row that still omits it) reads as
`owned` — today's meaning, unchanged. `accepted` means a pole that will
**not** be cut:

- `ticket` holds the **rationale** ticket that accepted it — this ticket
  may be closed; an accepted row is never refused as `unowned-row` for
  that reason, unlike an owned row.
- `note` carries `re-measure: YYYY-MM-DD` — the date (or landing event)
  by which the acceptance should be revisited, so acceptance is a
  recorded, dated act, never a silent, permanent carpet (the 2026-09-05
  directive this register already follows for owned rows).
- The verdict is `accepted`, printed on **every** run that touches the
  file, naming the measured duration, the rationale ticket, and the
  re-measure date — never silent like a healthy `ok` row, and never
  `new-pole`. A pole cannot be accepted and then forgotten.
- An accepted row whose file now measures under 80% of budget still
  reports `stale-row`, exactly like an owned row — acceptance ends when
  the cost that justified it does. A row whose file is not measured at
  all this run (renamed, deleted, or lane-excluded) also reports
  `stale-row`, using the register's own last recorded measurement — never
  silently dropped, which would otherwise let an accepted row go
  unreported indefinitely behind a possibly-closed rationale ticket.
- A file with **no row at all** is still refused as `new-pole` regardless
  of disposition: `accepted` only changes what an EXISTING row means, it
  is never a way to add a pole with no row.

`backlog/suite-poles.tsv` carries **no accepted row yet** — bl968's would
have been the first, but the specifier retired it in the same parcel that
built the mechanism (QA note 003855, S1) rather than land a row that would
read `stale-row` on arrival: accepting a pole only makes sense while it is
still actually over budget. A future pole whose cost is genuinely
permanent gets its own row in this shape instead:

```tsv
<file>	<rationale-ticket>	<first_seen>	<measured_ms>	accepted	<why it will not be cut>; re-measure: YYYY-MM-DD
```

The land step's row-retirement sweep (BL-1631) still never retires an
accepted row on the landing ticket's close — only an owned row drains that
way; an accepted row leaves the register only by a human/specifier edit
once its re-measure date is reached.

bl968's own two registry-load tests, assertions, and sweep semantics are
otherwise unchanged by this ticket — its temp-dir sweep now names its own
process id in the root prefix and drains through `tmpDir.js`'s
`sweepStaleTmpDirs` (BL-1623), the same pid-scoped sweep mechanism every
other fixture root in this tree uses, rather than a bare prefix listing of
the whole system temp directory. It no longer carries a register row at
all: at 2.57 s alone / 4.1–4.4 s in the lane, it is simply under budget.

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
[The property lane's own duration recorder](BL-1619-property-lane-duration-recorder.md) is this recorder's twin for `*.property.test.js`, with no budget gate of its own yet.
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
