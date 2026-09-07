# BL-1349 — coder bounce-fix (split), 2026-09-07

## What was wrong (architect bounce, `BL-1349-architect-bounce-20260907.md`)

`bl1252CommitGuardAggregationInvariants.property.test.js` still took
40-44s run alone even at the tuned `numRuns: 60` (×5 properties) — 2.7-2.9x
the 15s per-file ceiling. The other two tuned files (`onboarderLauncherPidGuard`,
`bl787NamedTunnelInvariants`) already met budget; only this one didn't.
Root cause (measured below): each of the file's five properties is
individually comfortably under budget - the file's SUMMED wall clock,
five properties bundled together, is what exceeded 15s. Architect's own
remediation direction: split, since the five properties are already
independent (`test('property (invariant N): ...')`, sharing only fixture
helpers).

## Implementation

- `extension/test/helpers/bl1252CommitGuardFixture.js` (new): every shared
  piece the five properties used - `ALL_GUARDS`/`INDEX_GUARDS`/`SUITE_GUARD`,
  `PLAN`/`GUARD_STATE`/the three plan generators, `writeFixture`,
  `runRunner`, `legacyChainRefuses`, `planKinds`/`assertReach`/`freshSeen`/
  `tally`, `withRoot` - extracted verbatim (no behavior change), so five
  files import ONE definition rather than five copies.
- `extension/test/bl1252CommitGuardAggregationInvariants.property.test.js`
  deleted; its five `test(...)` blocks moved, one per file, unchanged
  except for `numRuns` (still 60, unchanged from the prior tuning - see
  "Why numRuns didn't need to move" below):
  - `bl1252IndexGuardsAllRunInvariant.property.test.js` (invariant 1a)
  - `bl1252ViolatingGuardsAllNamedInvariant.property.test.js` (invariant 1b)
  - `bl1252RefusalPredicateUnchangedInvariant.property.test.js` (invariant 2a)
  - `bl1252ExpensiveGuardTieringInvariant.property.test.js` (invariant 2b)
  - `bl1252UnexpectedFailureNeverPassesInvariant.property.test.js` (invariant 3)
- `onboarderLauncherPidGuard.property.test.js` and
  `bl787NamedTunnelInvariants.property.test.js`: re-applied the SAME
  numRuns tuning (15→2, 6→2) architect already confirmed meets budget -
  the reverse-hop merge that delivered this bounce carried the same
  destructive-revert lineage that has now hit this ticket four times
  (see "Notes for the next role").
- `specs/pipeline/steps/bl1349SpawnHeavyPropertyBudgetSteps.js`: `KNOWN_FILES`
  (per-file budget Outline) now lists the five split files instead of the
  one merged one. New `NO_DELETION_SOURCES` (before-path -> after-paths[])
  drives the no-deletion scenario: onboarder and bl787 stay 1:1, bl1252's
  row compares the ONE pre-tuning file's content against the UNION of the
  five split files' current content - a property moved to a sibling file
  reads as "still present", never "deleted".
- `specs/features/BL-1349-spawn-heavy-property-files-fit-a-budget.feature`:
  the per-file-budget Scenario Outline's Examples table now lists the five
  split files instead of the one merged one (7 rows total, was 3).

## Why numRuns didn't need to move

Isolated timing, each property alone (`npx vitest run <file> --config
vitest.properties.config.mjs`), 3 runs each, `numRuns: 60` unchanged:

| File | run 1 | run 2 | run 3 |
|---|---|---|---|
| bl1252IndexGuardsAllRunInvariant | 8.32s | 8.58s | 7.83s |
| bl1252ViolatingGuardsAllNamedInvariant | 8.61s | 8.25s | 9.04s |
| bl1252RefusalPredicateUnchangedInvariant | 9.24s | 7.89s | 7.65s |
| bl1252ExpensiveGuardTieringInvariant | 8.34s | 8.17s | 7.89s |
| bl1252UnexpectedFailureNeverPassesInvariant | 8.20s | 8.13s | 8.10s |

All fifteen runs pass, all comfortably under the 15s ceiling (5-7s of
margin), no flakiness across three independent fast-check seeds. The
file-bundling was the whole defect - at the SAME `numRuns: 60`, five
properties summed to 40-44s but each alone costs ~8-9s. No further sample
reduction, so `assertReach`'s existing reach math (each property's own
`{clean, multiIndexViolation, unexpected, missing, suiteOnly}` subset,
unchanged since the original tuning) still applies unmodified - nothing to
re-derive.

## Verification

- Acceptance: `bash specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1349-spawn-heavy-property-files-fit-a-budget.feature`
  -> 8/8 scenarios pass: all 7 per-file-budget Outline rows (the five
  bl1252 splits, onboarder, bl787 - the slowest, bl787, at 13.26s, still
  comfortably under 15s) plus the no-deletion scenario (confirms all five
  bl1252 properties still present, `fc.property`/`fc.assert` counts
  unchanged, via the new union-of-splits comparison).
- No other file references the deleted filename except historical evidence
  (immutable by convention) and one stale command example in
  `docs/how-to/BL-1252-commit-guard-chain-reports-every-violation.md` line
  228 - documenter-domain, flagged below, not fixed here.
- `extension/vitest.properties.config.mjs`'s `include` is the glob
  `test/**/*.property.test.js` - the five new files are picked up and the
  deleted one drops out with no config change. The new
  `helpers/bl1252CommitGuardFixture.js` does not match that glob (correct -
  it is a shared module, not a test file).
- `grep -rn "bl1252" swarmforge/scripts/property_suite_standing_allowlist.tsv
  backlog/standing-reds.tsv` - no hits, nothing hand-enumerated there needed
  updating.

## Invariants (BL-654) — unchanged from the prior pass

Both of this ticket's declared invariants are about the SHAPE of the tuning
(no deletion/weakening; reduced sample count only on IO-spawning
properties), discharged by the ticket's own acceptance scenario 02 - see
`BL-1349-coder-pass-20260906.md`'s own "BL-654 invariant obligation"
section, unaffected by this split (the mechanism moved from a single-file
diff to a union-of-splits diff, same mechanical enforcement, still not a
`*.property.test.js` file since there is no new pure module here either).

## Notes for the next role

- **Documenter**: `docs/how-to/BL-1252-commit-guard-chain-reports-every-violation.md`
  line 228 still names the deleted file
  (`npx vitest run --config vitest.properties.config.mjs
  test/bl1252CommitGuardAggregationInvariants.property.test.js`) - needs
  updating to name one of the five split files (or drop the specific
  filename and describe the property suite generally).
- This is the FOURTH time this exact tuning has been reverted by a
  reverse-hop merge carrying an old destructive-revert lineage (see
  `BL-1448-coder-pass-20260907.md`'s own note on the same mechanism, and
  this file's own git log: `0c0fd19bae Revert "BL-1349: restore
  spawn-heavy numRuns tuning..."`, itself reverting `832429ff79`, itself
  restoring what an EARLIER revert had dropped). Every prior instance was
  the SAME architect-bounce-revert pattern propagating through a
  reverse-hop copy into a sibling branch that hadn't yet seen the
  restoring commit. Worth a `rule_proposal` or a specifier note if it
  recurs a fifth time - the mechanism (not this ticket's content) is the
  actual repeat offender.
