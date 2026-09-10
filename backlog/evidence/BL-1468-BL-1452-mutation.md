# BL-1468: BL-1452's deferred Stryker mutation gate — run and discharge

Survivors: 1
Load: 9.38/20 cores (quiet, mutation_cooldown_gate.bb's own reading at start)
Duration: 21s (run 1, first-ever); 21s (run 2, after test hardening)

## What ran

`npx stryker run stryker.bl1468.config.json` (perTest coverage analysis,
concurrency 4, vitest runner scoped to
`vitest.bl1468.stryker.config.mjs` → `test/backlogTicketId.test.js`,
`test/recordQaBounceCli.test.js`, `test/qaSiblingCheckCli.test.js`), over
the three compiled files BL-1452's hardener pass deferred:

- `out/tools/backlogTicketId.js`
- `out/tools/bounceArgsCore.js`
- `out/tools/qa-sibling-check.js`

Cooldown gate (`mutation_cooldown_gate.bb`) checked clear on all three
source files immediately before starting: `DECISION: run,
file_age_days: 3.36 (cooldown: 1 days)`.

## Load and duration

- Load at start (`mutation_cooldown_gate.bb`'s own reading): `load_avg:
  9.38 cores: 20 busy_threshold: 2.00x (quiet)` — within the gate's own
  "quiet" band despite being in the 6.7-9.7 range that caused BL-1452's
  two prior timeouts; the gate's threshold (2.00x = 40) still called it
  quiet.
- Run 1 (initial, first-ever run over this file set): completed in
  **21 seconds** — no timeout, unlike BL-1452's two dry-run attempts.
- Run 2 (after the test hardening below, recompiled): completed in
  **21 seconds**.
- Both runs completed well inside Stryker's 5-minute ceiling; no attempt
  recorded (this is a completed run, not a blocked attempt — invariant 1).

## Result

First run: 250 mutants tested, 245 killed, 5 survived (mutation score
98.00%). Per the 2026-09-10 hardener rule_proposal (accepted into
`hardener.prompt`/`specifier.prompt`, commit `a17bc78d43`): a first run's
survivors at or under ~50 are killed in-pass by default. 5 ≤ 50, so they
were chased in this same coder pass — test-only changes
(`extension/test/qaSiblingCheckCli.test.js`), no production code touched,
per this ticket's own constraint.

4 of the 5 were killed by strengthening existing assertions (exact
`REFUSED` message substrings, the `list` line in the USAGE text) or adding
one new case (`list` rejecting an odd-length argument list whose flag
happens to equal Stryker's own `ArrayDeclaration` placeholder, guarding
`LIST_FLAGS` staying empty).

Second run (after the fix): 250 mutants tested, 249 killed, **1
survived** (mutation score 99.60% / 99.44% on `qa-sibling-check.js`).

```
Ran 4.61 tests per mutant on average.
                     | % Mutation score |          |           |            |          |          |
File                 |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
All files            |  99.60 |   99.60 |      249 |         0 |          1 |        0 |        0 |
 backlogTicketId.js  | 100.00 |  100.00 |       10 |         0 |          0 |        0 |        0 |
 bounceArgsCore.js   | 100.00 |  100.00 |       62 |         0 |          0 |        0 |        0 |
 qa-sibling-check.js |  99.44 |   99.44 |      177 |         0 |          1 |        0 |        0 |
```

## The one remaining survivor — reason

```
[Survived] ConditionalExpression
out/tools/qa-sibling-check.js:62:40
-           if (!allowed.includes(flag) || value === undefined) {
+           if (!allowed.includes(flag) || false) {
```

- ConditionalExpression at out/tools/qa-sibling-check.js:62:40 — accepted equivalent, already documented in source at `extension/src/tools/qa-sibling-check.ts:74-83` (BL-234 precedent).

**Reason: accepted equivalent, already documented in source.**
`extension/src/tools/qa-sibling-check.ts:74-83` carries a standing
"hardener note" (predating this ticket, BL-234 precedent) explaining that
forcing `value === undefined` to `false` — silently accepting a trailing
flag with no value instead of refusing it here — is equivalent for every
caller in this file: a dangling flag only ever arises as argv's final,
odd-length pair, and every `parse*Args` function already rejects an
undefined/falsy value for each of its required fields downstream, so the
short-circuit only moves the rejection one call deeper. This ticket adds
no new reasoning; it cites the existing one.

## Invariants (BL-654) — both admit no new encoding in this parcel

Same shape as BL-1441's coder pass (`backlog/evidence/BL-1441-coder-pass-20260906.md`);
this ticket's invariants are BL-1441's invariant 1/2 restated (the
ticket's own description: "invariant 1 of BL-1441/BL-1468/BL-1488"):

1. *"A ledger row leaves the outstanding debt only through a discharge
   that names the gate, the parcel and a committed result; a run that
   cannot complete is recorded as an attempt with its blocker and the row
   stays outstanding and owned."* This is the ledger MECHANISM's own
   contract, built and property-tested by BL-1439/BL-942
   (`bl942_hardening_debt_ledger_property_runner.bb`, re-run this pass:
   **ok**, unmodified). This parcel is a CONSUMER of that mechanism
   (`--discharge` via the CLI), not a modifier of it — no ledger code
   changed here. Writing a second property test asserting the same
   mechanism BL-1439's own suite already covers would be a duplicate test
   of code this parcel does not touch, not a new encoding of anything
   this parcel adds.
2. *"The register row leaves in the same commit that discharges the
   ledger row, never earlier; the hardening lane holds no BL-1468 row
   only when the BL-1452 row is discharged."* This quantifies over a GIT
   WORKFLOW discipline (which lines a commit's diff contains, together, in
   one commit) — process, not a pure module a property test can exercise
   (BL-654's own carve-out: "record a stated reason... when a declared
   invariant admits no executable encoding"). Honoured directly instead:
   the `backlog/standing-reds.tsv` line removal is staged in the SAME
   commit as the ledger discharge and this evidence file (commit
   `d458b242bc`).

## Discharge

`hardening_debt_ledger_update.bb --discharge BL-1452 mutation --evidence
backlog/evidence/BL-1468-BL-1452-mutation.md` (this file) — the ledger row
is marked discharged, invariant 1 satisfied (a committed result, not an
attempt). The `hardening` register row naming BL-1468 is removed in the
same commit (invariant 2).
