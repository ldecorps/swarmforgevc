# BL-1439 — coder pass on the specifier's amendment, 2026-09-06

## Context

The architect's own pass (`backlog/evidence/BL-1439-architect-pass-20260905.md`)
found no defect in the original coder/cleaner work - the ledger discharge
mechanism was correct and the four undischarged gates were genuinely,
honestly blocked. While the architect held the parcel, the specifier
independently reached the same "land what's done, don't hold on external
blockers" conclusion, going further: minted BL-1440 (owns the
`constitutionDocCitations` red) and BL-1441 (owns the four still-blocked
Stryker runs), and amended BL-1439's own scenario 03 and `required_wiring`
to add a third ledger verb, `--attempt`. The architect forwarded the
amended, unimplemented requirement to coder rather than sending an
already-stale candidate to hardener - correctly, no bounce recorded (the
architect's own review found nothing wrong with what existed).

## What landed

- **`swarmforge/scripts/hardening_debt_ledger_lib.bb`**: `record-attempt`
  - the third verb (amendment's own required_wiring entry). Matches a row
    by `(parcel, gate)`, same identity `discharge-debt` uses; sets
    `:attempted-at`/`:attempted-blocker` but NEVER `:discharged-at` -
    `outstanding-debt` (unchanged, still filters on `:discharged-at`
    alone) keeps reporting an attempted row, because an attempt is
    evidence a real try happened, not proof the debt was paid (invariant
    3, carried unchanged from the original ticket). Refuses (rows
    unchanged) with no blocker text or no matching row. `field->key`
    gains `attempted_at`/`attempted_blocker` (parsed generically, no
    other parser change); `render-row` writes them (the blocker text
    quoted/escaped the same way `reason`/`load` already are, since it is
    the same kind of free-form prose).
- **`swarmforge/scripts/hardening_debt_ledger_update.bb`**: `--attempt
  <parcel> <gate> <blocker> [<attempted-at>]`.
- **`swarmforge/scripts/hardening_debt_ledger_read.bb`**: now also prints
  `attempted_at`/`attempted_blocker` (null on a row with no attempt yet).
- **The four blocked rows recorded as real attempts** (not prose-only):
  `hardening_debt_ledger_update.bb --attempt` run once per row, naming
  the exact blocker already documented in
  `backlog/evidence/BL-1439-coder-20260905.md` (cooldown for
  BL-620/BL-955/BL-956-mutation, the `constitutionDocCitations` red for
  BL-954), each explicitly naming BL-1441 as the ticket that owns the
  eventual run.
- **`backlog/standing-reds.tsv`**: the four still-outstanding hardening
  rows re-pointed from `BL-1439` to `BL-1441` (the amendment's own
  requirement: "every outstanding row has a register row naming
  BL-1441"); the discharged BL-956/gherkin-mutation row was never
  re-added (it correctly carries no register row at all - a discharged
  row has none, per BL-1428's own design and this amendment's wording).
- **`specs/pipeline/steps/bl1439DeferredHardeningGatesDischargedSteps.js`**:
  scenario 03's two `Then` steps rewritten to match the amended
  scenario text exactly (discharged-or-attempted, and the
  BL-1441-ownership check per row).
- Unit coverage: 8 new assertions (`record-attempt`'s match/refusal/
  round-trip, mirroring `discharge-debt`'s own test shape exactly) plus
  7 new CLI wiring checks for `--attempt`.

## Non-vacuity (byte-identical restore confirmed)

Mutated `record-attempt`'s blank-blocker guard to `(if false ...)` (never
refuses) - the two refusal-path unit tests failed immediately (an empty
blocker was silently accepted). Restored;
`diff /tmp/hardening_debt_ledger_lib.bb.bak2
swarmforge/scripts/hardening_debt_ledger_lib.bb` empty; both unit and
CLI-wiring suites confirmed back to green immediately after.

## Verification

| check | result |
|---|---|
| `bb .../test/hardening_debt_ledger_lib_test_runner.bb` (+8) | ok |
| `bash .../test/test_hardening_debt_ledger_cli.sh` (+7) | ALL CHECKS PASSED |
| `bb .../test/bl942_hardening_debt_ledger_property_runner.bb` | ok, unaffected |
| acceptance `BL-1439-....feature` | **4/4** (was 3/4 before this amendment pass), stable across two runs |
| `bb .../standing_red_register_cli.bb .` (live) | all 4 outstanding hardening rows now name `BL-1441`; the discharged row carries none |
| `bb .../hardening_debt_ledger_read.bb .` (live) | 1 row discharged (BL-956/gherkin-mutation), 4 rows carry `attempted_at`/`attempted_blocker`, none of the 4 carry `discharged_at` |

## Invariants (amended set, all three carried/reconfirmed)

1. Never deleted, only marked - now true of BOTH discharge and attempt.
2. One filter (`outstanding-debt`, on `:discharged-at` alone) for the
   register/throttle - unchanged; an attempt does not trip this filter,
   by design (it is not a discharge).
3. A gate that cannot complete stays outstanding, never discharged by
   assertion - now backed by a REAL ledger record (`attempted_at`/
   `attempted_blocker`) instead of only prose in an evidence file, and
   ownership of that still-outstanding debt is explicit (BL-1441) rather
   than left on the ticket that could not finish it.

## required_wiring (amended set)

- `swarmforge/scripts/hardening_debt_ledger_update.bb::--discharge` -
  present (unchanged from the original pass).
- `swarmforge/scripts/hardening_debt_ledger_lib.bb::discharged` -
  present (unchanged).
- `swarmforge/scripts/hardening_debt_ledger_update.bb::--attempt` -
  present (this pass).
- `specs/pipeline/steps/bl1439DeferredHardeningGatesDischargedSteps.js::registerSteps` -
  present; acceptance now 4/4.

## Out of scope (unchanged from the original pass, now formally BL-1441's)

- Actually running the four blocked Stryker mutation gates - BL-1441,
  not before 2026-09-08 (cooldown) and not before BL-1440 lands
  (citation red).
- BL-1440's own fix (the `constitutionDocCitations` red / missing docs)
  - a separate ticket, already minted, not touched here.
