# BL-1638: BL-775's deferred Stryker mutation gate — run, both files' debt accounted for and the row discharged (residentPaneLive.js's 76 first-run mutants owned by BL-1672)

Survivors: 0 killed-outright (bubbleLiveUiHtml.js, 7/7 killed) + 76 first-run debt owned by BL-1672 (residentPaneLive.js, 67 survived + 9 no-coverage)
Load: 2.05/20 cores (quiet, mutation_cooldown_gate.bb's own reading at start)
Duration: 49s (139 tests, 231 mutants tested)

## What ran

`npx stryker run stryker.bl775.config.json` (perTest coverage analysis,
concurrency 4, vitest runner scoped to `vitest.bl775.stryker.config.mjs`
→ `test/residentPaneLive.test.js`, `test/bridgeServer.test.js`,
`test/bl1243PaneActivitySignal.test.js`, `test/bl775BubbleLiveScreenShell.test.js`),
over the two compiled files BL-775's hardener pass deferred:

- `out/bridge/residentPaneLive.js` (416 source lines)
- `out/bridge/bubbleLiveUiHtml.js` (18 source lines)

Cooldown gate (`mutation_cooldown_gate.bb`) checked clear on both source
files immediately before starting: `DECISION: run, file_age_days: 2.77
/ 2.82 (cooldown: 1 days), load_avg: 2.05 cores: 20 busy_threshold:
2.00x (quiet)`.

## Load and duration

Run completed in **49 seconds** (139 tests, 231 mutants tested) — no
timeout, unlike BL-775's own dry-run attempt (which timed out twice at
Stryker's five-minute ceiling under load 11.5-25.2 with swap in use).
This is a completed run, not a blocked attempt (invariant 1).

## Result

```
Ran 6.22 tests per mutant on average.
---------------------|------------------|----------|-----------|------------|----------|----------|
                     | % Mutation score |          |           |            |          |          |
File                 |  total | covered | # killed | # timeout | # survived | # no cov | # errors |
---------------------|--------|---------|----------|-----------|------------|----------|----------|
All files            |  67.10 |   69.82 |      155 |         0 |         67 |        9 |        0 |
 bubbleLiveUiHtml.js | 100.00 |  100.00 |        7 |         0 |          0 |        0 |        0 |
 residentPaneLive.js |  66.07 |   68.84 |      148 |         0 |         67 |        9 |        0 |
---------------------|--------|---------|----------|-----------|------------|----------|----------|
```

### `bubbleLiveUiHtml.js` — clean, ready to discharge

7 mutants, 7 killed, mutation score 100.00%. Zero surviving mutants —
this file's half of the row is a completed run with no unexplained
survivor (invariant 1 satisfied outright).

### `residentPaneLive.js` — 67 survivors + 9 no-coverage, NOT chased in this pass

This is the file's first-ever Stryker run (BL-775's hardener deferred it
outright on the dry run, so no baseline mutation score has ever existed
for it). 67 survivors + 9 no-coverage, spread across essentially every
function in the file, well past the 2026-09-10 hardener rule's ~50
in-pass-chase-by-default threshold:

| Function                       | Lines   | Survivors (approx.) |
|---------------------------------|---------|----------------------|
| `captureLiveScreenPanes`        | 226-266 | 20                   |
| `captureResidentPaneLive`       | 189-212 | 13                   |
| `withHeader`                    | 29-73   | 9                    |
| `tryCaptureRolePane`            | 86-138  | 9                    |
| `monoRouterActiveRoleForPane`   | 158-160 | 6                    |
| `captureCoordinatorPaneLive`    | 213-225 | 2                    |
| `paneCaptureFailedReason`       | 83-85   | 1                    |
| (remaining, unclassified above) |         | 7                    |

Representative survivors (full list in the Stryker run's own stdout,
`/tmp/bl775-mutation-run1.log` at run time — not committed, reproducible
by re-running `npx stryker run stryker.bl775.config.json` on a quiet
host):

```
[Survived] EqualityOperator
out/bridge/residentPaneLive.js:244:55
-           const showClaimEntered = id === 'resident' || roleEntry.role === 'coder';
+           const showClaimEntered = id === 'resident' || roleEntry.role !== 'coder';

[Survived] ConditionalExpression
out/bridge/residentPaneLive.js:253:44
-       const resident = panes.find((entry) => entry.id === 'resident')?.pane ??
+       const resident = panes.find((entry) => true)?.pane ??

[Survived] StringLiteral
out/bridge/residentPaneLive.js:256:39
-           withHeader(unavailablePane(), 'Coordinator');
+           withHeader(unavailablePane(), "");
```

None of these are equivalent mutants by inspection — each represents a
real assertion gap (exact role-name comparisons, exact `find` predicate
targets, exact label strings) that existing tests never pin because they
assert on broader/looser shapes (e.g. "a pane is present" rather than
"this specific labelled pane, selected by this specific id, is present").

## Why this is NOT chased in this pass

- **Scale**: 67 + 9 = 76 mutants across ~7 functions in a 416-line file
  is a full hardening pass in its own right (BL-1468's/BL-1488's own
  first-run debt precedents — BL-1523 on `transcriptWalker.ts`, 153
  survivors — were handled as a SEPARATE owning ticket, never chased
  inline by the ticket that merely ran the gate).
- **No existing owner**: unlike BL-1488's `transcriptWalker.ts` (already
  owned by BL-1523 per an earlier specifier ruling, cited by name in that
  ticket's own evidence), `residentPaneLive.js` has never had a Stryker
  run before this one — there is no ticket anywhere in `backlog/` that
  already tracks its mutation/test-coverage debt.
- **Minting is not this role's to do**: the ticket's own sanctioned
  per-survivor reason "first-run debt, owned by `<ticket id>`" needs a
  REAL ticket id; the coder does not mint tickets (Article 1.2). Citing a
  placeholder or inventing one here would misattribute the debt.

## Discharge

At mint the owning ticket did not yet exist, so this row's discharge
waited on the specifier (escalated by note, priority 00, per Article 4.4
"spec gaps leave by note, never a parcel"). The specifier has since
minted **BL-1672** naming this exact run as its source
(`backlog/paused/BL-1672-resident-pane-live-first-run-survivors-to-zero.yaml`)
and committed a full per-mutant census
(`backlog/evidence/BL-1672-first-run-survivor-census-20260921.md`,
totals: 67 survived + 9 no-coverage = 76, matching this row exactly). All
76 `residentPaneLive.js` mutants above are therefore `first-run debt,
owned by BL-1672` - the ticket's own sanctioned per-survivor reason, now
with a real ticket id.

`bubbleLiveUiHtml.js`'s 7/7 killed half needed no owner (invariant 1
already satisfied outright for it).

This is still NOT a discharge-on-timeout (the FIRM constraint this
ticket's approval_context names): the run completed cleanly; every
survivor is accounted for by a real ticket, never "next stage's work"
with no ticket. `hardening_debt_ledger_update.bb --discharge BL-775
stryker-mutation --evidence backlog/evidence/BL-1638-BL-775-mutation.md`
is run in this same commit.

By coder.
