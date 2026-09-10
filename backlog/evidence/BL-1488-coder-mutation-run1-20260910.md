# BL-1488 — coder pass, 2026-09-10: the deferred BL-1476 Stryker run, as measured

## What ran

Cooldown re-checked live immediately before the run (per the ticket's own
warning that `not_before` arithmetic goes stale):

```
$ bb swarmforge/scripts/mutation_cooldown_gate.bb . extension/src/metrics/transcriptWalker.ts
DECISION: run
file_age_days: 2.86 (cooldown: 1 days)
load_avg: 8.96 cores: 20 busy_threshold: 2.00x (quiet)
```

All three files answered `DECISION: run` under the current 1-day cooldown
key. Host load at start: `load_avg: 5.01 cores: 20` (quiet, well under the
2x/40 busy threshold).

`npx stryker run stryker.bl1488.config.json` (new config, this parcel;
perTest coverage analysis, concurrency resolved by
`mutation-concurrency.js` to 17; vitest runner scoped to the existing
`vitest.bl1476.stryker.config.mjs` → `test/transcriptWalker.test.js`,
`test/turnProfileProducer.test.js`, `test/runTurnProfileProducer.test.js`,
`test/transcriptSummaryStore.test.js`), over the three compiled files
BL-1476's hardener pass deferred:

- `out/metrics/transcriptWalker.js`
- `out/metrics/turnProfileProducer.js`
- `out/tools/run-turn-profile-producer.js`

Compiled first (`npm run compile`) against a clean worktree (no
production-code diff — `git status` was clean before this ticket started).

## Load and duration

Survivors: 120

Load: 5.01/20 cores at start (quiet; `mutation_cooldown_gate.bb`'s own
reading), matching `uptime`'s 8.96/6.52/5.88 1/5/15-minute averages.
Duration: 28 seconds. The run completed — no timeout, no dry-run failure;
this is not a blocked "attempt" under invariant 1, it is a completed run
with a result.

## Result — NOT a clean discharge

```
Ran 4.61 tests per mutant on average.
-------------------------------|------------------|----------|-----------|------------|----------|----------|
                               | % Mutation score |          |           |            |          |          |
File                           |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-------------------------------|--------|---------|----------|-----------|------------|----------|----------|
All files                      |  69.69 |   76.92 |      400 |         0 |        120 |       54 |        0 |
 metrics                       |  67.97 |   75.26 |      365 |         0 |        120 |       52 |        0 |
  transcriptWalker.js          |  58.77 |   68.21 |      191 |         0 |         89 |       45 |        0 |
  turnProfileProducer.js       |  82.08 |   84.88 |      174 |         0 |         31 |        7 |        0 |
 tools                         |  94.59 |  100.00 |       35 |         0 |          0 |        2 |        0 |
  run-turn-profile-producer.js |  94.59 |  100.00 |       35 |         0 |          0 |        2 |        0 |
-------------------------------|--------|---------|----------|-----------|------------|----------|----------|
```

120 survived + 54 no-coverage = **174** unresolved mutants, concentrated in
`transcriptWalker.js` (89 survived + 45 no-coverage = 134) and
`turnProfileProducer.js` (31 survived + 7 no-coverage = 38).
`run-turn-profile-producer.js` is close to clean (2 no-coverage, both on
the thin CLI `main()` wrapper — the `entrypoint-boilerplate` ignorer did
not suppress them; not investigated further here since it is not the
gap driving this evidence).

Spot-checked the survivor list by mutator/line (full breakdown in
`/tmp` run log, not committed): these are **not** the barrel-export
`Object.defineProperty(exports, ...)` getter noise seen in BL-1468's one
accepted-equivalent survivor. They land on live business logic —
`Regex`, `ConditionalExpression`, `StringLiteral`, `EqualityOperator` and
`LogicalOperator` mutants at real line numbers throughout
`transcriptWalker.js` (e.g. lines 68-231) and `turnProfileProducer.js`.
This reads as genuine, pre-existing test-coverage debt on these two
files, not equivalent-mutant artifacts.

## Why this ticket does not discharge the ledger row

This ticket's mint-time framing (`mutation_cost: low`, "no code changes;
one Stryker run over a compiled file set already unit- and
property-tested") assumed a clean or near-clean run, the same shape as
BL-1441/BL-1468 (5 and 1 survivors respectively, both closed **in the
coder's own pass** via test-only hardening). The hardener's own accepted
rule (2026-09-10, `a17bc78d43`) treats a first run's survivors **at or
under ~50** as chased in-pass by default. 174 is well over 3x that
threshold and lands squarely in `transcriptWalker.js`, whose 58.77%
mutation score signals a real, substantial gap — not a handful of
equivalent mutants to reason away with a one-line note each.

Fabricating 174 individual "accepted equivalent" reasons to satisfy the
letter of the ledger discharge would launder real, undertested risk out
of the register the throttle depends on (BL-1429) — the opposite of what
the ledger exists for. Writing genuine tests to close 174 mutants is
squarely the hardener's remit (Article 1.6: "Improves test coverage,
kills mutants, and reduces CRAP metrics"), not a "no production code
changes" coder ticket's.

**The BL-1476 ledger row stays outstanding, owned by BL-1488** (not
unowned — this ticket exists and is active). No `--discharge` was run.
No register row was removed. This parcel forwards through the normal
pipeline (cleaner → architect → hardener) so the hardener can assess
real coverage work here; the ticket's own `mutation_cost`/`slice_size_envelope`
estimate should be revisited once that's sized.

A priority-00 note goes to the specifier and coordinator alongside this
evidence flagging the discrepancy between the ticket's mint-time premise
and the measured result.

## Invariants (BL-654)

1. *"A ledger row leaves the outstanding debt only through a discharge
   that names the gate, the parcel and a committed result; a run that
   cannot complete is recorded as an attempt with its blocker and the
   row stays outstanding and owned."* Honoured directly: the run
   completed (not blocked), but its result (174 unresolved mutants) does
   not meet "zero survivors or a reason per survivor" in good faith, so
   no discharge is recorded and the row stays outstanding and owned by
   BL-1488, exactly as the invariant requires when a clean discharge
   isn't yet warranted.
2. *"The register row leaves in the same commit that discharges the
   ledger row, never earlier."* Not yet applicable — no discharge has
   happened in this commit, so the register row for BL-1488 correctly
   stays in place.

## Step handler

`specs/pipeline/steps/bl1488Bl1476DeferredMutationGateIsRunSteps.js`
lands in this same commit (BL-233 shape — the handler lands with the
feature). Run against the current (undischarged) state, both scenarios
correctly **fail** — accurate evidence that this parcel is not yet
complete, not a defect in the wiring:

```
not ok 1 - the BL-1476 ledger row is discharged and the register holds no hardening row for its file set
not ok 2 - the discharge evidence records a completed run over the three files
```
