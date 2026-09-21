# BL-1638: BL-831's deferred Stryker mutation gate — run and discharge

Survivors: 1 (accepted equivalent) + 1 no-coverage (accepted equivalent, dead defensive code)
Load: 2.05/20 cores (quiet, mutation_cooldown_gate.bb's own reading at start)
Duration: 5s (run 1, first-ever); 5s (run 2, after test hardening)

## What ran

`npx stryker run stryker.bl831.config.json` (perTest coverage analysis,
concurrency 4, vitest runner scoped to `vitest.bl831.stryker.config.mjs`
→ `test/bubblePipelinePage.test.js`), over the one compiled file BL-831's
hardener pass deferred:

- `out/bridge/bubblePipelinePage.js`

Cooldown gate (`mutation_cooldown_gate.bb`) checked clear immediately
before starting: `DECISION: run, file_age_days: 2.81 (cooldown: 1 days),
load_avg: 2.05 cores: 20 busy_threshold: 2.00x (quiet)`.

## Load and duration

- Run 1 (initial): 114 mutants instrumented, completed in **5 seconds**
  — no timeout, unlike BL-831's own dry-run attempt (which never got past
  "Starting initial test run" before the 300s wrapper ceiling).
- Run 2 (after the test hardening below, recompiled): completed in
  **5 seconds**.
- Both runs completed well inside Stryker's 5-minute ceiling; no attempt
  recorded (this is a completed run, not a blocked attempt — invariant 1).

## Result

First run: 45 mutants tested, 36 killed, 8 survived, 1 no-coverage
(mutation score 80.00%). Per the 2026-09-10 hardener rule_proposal, a
first run's survivors at or under ~50 are chased in-pass by default.
9 ≤ 50, so they were chased in this same coder pass — test-only changes
(`extension/test/bubblePipelinePage.test.js`), no production code
touched, per this ticket's own constraint.

Every one of the 8 survivors was killed by strengthening existing
assertions (asserting the real `title` field, not just `blurb`; picking
the correct ticket among several rather than merely the first; a
coincidental file at a wrongly-computed path never being read) or adding
one new fixture line free of any surrounding whitespace after the
`Scenario:`/`Scenario Outline:` label (forcing the label-stripping
regex's own trailing `\s*` to matter, rather than being masked by the
downstream `.trim()` either way).

Second run (after the fix): 45 mutants tested, 43 killed, **1 survived**,
1 no-coverage (mutation score 95.56% / 97.73% covered).

```
Ran 0.98 tests per mutant on average.
-----------------------|------------------|----------|-----------|------------|----------|----------|
                       | % Mutation score |          |           |            |          |          |
File                   |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
-----------------------|--------|---------|----------|-----------|------------|----------|----------|
All files              |  95.56 |   97.73 |       43 |         0 |          1 |        1 |        0 |
 bubblePipelinePage.js |  95.56 |   97.73 |       43 |         0 |          1 |        1 |        0 |
-----------------------|--------|---------|----------|-----------|------------|----------|----------|
```

## The two remaining mutants — reasons

```
[NoCoverage] LogicalOperator
out/bridge/bubblePipelinePage.js:62:66
-               blurb: item ? (0, pipelineGridLive_1.blurb)(item) : (row.title ?? row.id),
+               blurb: item ? (0, pipelineGridLive_1.blurb)(item) : (row.title && row.id),
```

**Reason: accepted equivalent, dead defensive code.** The module's own
header comment (`extension/src/bridge/bubblePipelinePage.ts` lines 1-11,
invariant 1) states every row's id is guaranteed present in `byId`
(`data.rows` and `byId` are both built from `computeLivePipelineBoard`'s
same underlying set), so the `item` ternary's else-branch is defensive
code the current invariant proves unreachable — forcing a test to violate
that invariant (fabricate a row absent from `byId`) would test an
impossible state, not a real one, and is out of this ticket's "no
production code changes" scope regardless.

```
[Survived] Regex
out/bridge/bubblePipelinePage.js:71:37
-           .map((line) => line.replace(/^\s*(Scenario|Scenario Outline):\s*/, '').trim());
+           .map((line) => line.replace(/\s*(Scenario|Scenario Outline):\s*/, '').trim());
```

**Reason: accepted equivalent, provably so.** `.map()` here runs only
over lines the immediately preceding `.filter()` (line 70) already proved
match `/^\s*(Scenario|Scenario Outline):/` — i.e. every string this
`.replace()` ever sees is known to have the (optional-whitespace)+label
sequence starting at index 0. `String.prototype.replace` (no `/g` flag)
returns the leftmost match; since the anchored and unanchored patterns
agree on the leftmost possible match position whenever the target string
already starts with the pattern, removing the `^` anchor cannot change
the result for any input this code path can ever receive. (The FILTER's
own anchor, one line up, is a different, live invariant: a fixture
comment line naming "Scenario:" mid-line — not at the true start — is
covered above and correctly excluded by scenario 07's own test; killing
that mutant proves the filter's anchor is load-bearing even though the
replace's is not.)

## Invariants (BL-654) — both admit no new encoding in this parcel

Same reasoning as BL-1468/BL-1488's own coder passes (this ticket's
description cites BL-1441/BL-1468/BL-1488's shape for both invariants):

1. *"A ledger row leaves the outstanding debt only through a discharge
   that names the gate, the parcel and a committed result; a run that
   cannot complete is recorded as an attempt and leaves the row
   outstanding and owned."* This is the ledger MECHANISM's own contract
   (BL-1439/BL-942), unmodified here — this parcel is a CONSUMER
   (`--discharge` via the CLI), not a modifier.
2. *"A register row leaves in the same commit that discharges its ledger
   row, never earlier."* Process discipline, not a pure module a property
   test can exercise (BL-654's carve-out) — honoured directly: the
   `hardening` register row naming BL-1638 for `bubblePipelinePage.js` is
   removed in the SAME commit as this discharge.

## Discharge

`hardening_debt_ledger_update.bb . --discharge BL-831 stryker-mutation
--evidence backlog/evidence/BL-1638-BL-831-mutation.md` — the ledger row
is marked discharged, invariant 1 satisfied (a committed result, not an
attempt).

## Scope note — BL-775's row is NOT discharged in this same pass

BL-1638's OTHER row (parcel BL-775, files `bubbleLiveUiHtml.js` +
`residentPaneLive.js`) hit a materially different shape: see
`backlog/evidence/BL-1638-BL-775-mutation.md` — `bubbleLiveUiHtml.js` is
clean (100%), but `residentPaneLive.js` surfaced 67 survivors + 9
no-coverage mutants, well past the ~50 in-pass-chase threshold and with
no existing first-run-debt owner (unlike BL-1488's transcriptWalker.ts,
which already had BL-1523). Discharging that row now under "first-run
debt, owned by <ticket id>" needs a real ticket id, which only the
specifier can mint (Article 1.2) — escalated by note rather than
decided here. This ticket (BL-1638) therefore stays open; only BL-831's
half is complete.

By coder.
