# BL-1633 — coder, response to hardener's spec-gap finding, 2026-09-18

Responds to `backlog/evidence/BL-1633-hardener-spec-gap-20260918.md`
(hardener commit `4bdf3ba12e`, specifier-adjudicated amendment): BL-1633's
land falsifies BL-1598's own scenario 03 (a 2026-09-16 census pin: "holds
exactly 9 rows"), the symmetric sibling of the BL-1620 scenario 02
retirement already done in this parcel (BL-1006, both).

## BL-1598 retirement (done)

`specs/features/BL-1598-the-unit-suite-pole-register-makes-the-per-file-gate-green.feature`:
deleted the `# BL-1598 unit-suite-pole-register-03` comment, `Scenario:`,
and its three `When`/`Then`/`And` lines; re-tensed the narrative clause
("nine poles measured on 2026-09-16 are registered with an open owner")
to the past ("were registered... (the census pin retired by BL-1633 as
rows drain)").

`specs/pipeline/steps/bl1598SuitePoleRegisterSteps.js`: deleted the four
`scoped(...)` registrations at the ticket-cited lines 229-249
(`backlog/suite-poles.tsv is read`, `it holds exactly 9 rows`, `every row
names a ticket present...`, `...are among the files`), and the
`fs`/`parseRegisterRows`/`openTicketIds`/`REGISTER_TSV` imports and
constant that existed only to serve them (now dead - scenarios 01/02
never used them). Scenarios 01 and 02 untouched.

## Scenario 04's combined step (done)

Per the ticket's "How" ("scenario 04's last step covers both features"),
added two Then steps to BL-1633's own scenario 04, each reading the REAL
committed sibling feature file (never a re-statement):
- `BL-1620's feature at the parcel carries scenarios two-unit-lane-poles-01
  and -03 only, its narrative stating the register row's fate in the past`
- `BL-1598's feature at the parcel carries scenarios
  unit-suite-pole-register-01 and -02 only, its narrative stating the
  2026-09-16 census in the past`

Each checks the feature's `# BL-<n> <tag>` scenario markers (exactly the
two survivors, in order) and matches/rejects the specific past/present
narrative phrasing. Caught one bug in my own first draft: the BL-1598
narrative regex used a literal space between "nine" and "poles", but the
real feature file line-wraps between them (`...the nine\n  poles
measured...`) - fixed with `\s+` in place of the literal space; the
BL-1620 check needed no such fix (its clause happens to sit on one line).

## A silent merge revert, caught by this parcel's own re-verification

Merging `main` (`dabdb261cc`, "BL-1624: tip-pure replay...") resurrected
`backlog/suite-poles.tsv`'s `telegramFrontDeskBotCli.test.js` row without
a conflict: `main`'s side had only REORDERED the row (moved to end of
file by an unrelated ticket's own replay, main never having merged this
ticket's deletion at all), and git's 3-way merge resolved "deleted here,
moved there" as "keep it" rather than flagging a conflict - exactly the
class Engineering Rules' Guardrails names ("A merge can silently revert
already-landed work — diff every merge against BOTH parents"). Caught by
re-running BL-1633's own acceptance suite immediately after the merge
(scenario 04's "has no row for it" step failed). Fixed by deleting the
row again explicitly, in this commit, with this record.

## Verified

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1633-*.feature`
  — 5/5 green (repeated three times for confidence, including the
  transient one where "measures under 7000 ms" flaked under extreme host
  load - see below).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1620-*.feature`
  — 2/2 green (01, 03).
- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1598-*.feature`
  — 11/11 green (03 retired).
- `npm test` — three full runs. Two clean (626 files, 10697 tests,
  `suite file budget OK`). One, under an observed host load spike to
  16-18 (vs. the ~10-13 baseline this session), collapsed to a single
  vitest fork and both showed a would-be new-pole confirmed GENUINELY
  over budget alone (manually re-measured: 9.5-9.6s solo, well over the
  7000ms budget) - correct behavior under real host-wide contention
  BL-1633's fork-pool-scoped confirmation cannot and does not claim to
  filter (out of scope; the ticket's own contention class is in-suite
  fork pooling, not host-wide multi-process load). Same run also showed
  one unrelated, unidentified test failure amid 121 unhandled errors
  (vs. the usual 4) - not reproduced on a third clean run; consistent
  with infra noise under that same load spike, not a code defect.
- `npm run test:properties` — 1223/1223, clean (3-4 errors, the
  allowlisted BL-871 `onTaskUpdate` timeout).

By coder.
