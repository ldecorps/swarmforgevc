# BL-1335 hardener pass — 2026-09-03

Merged architect commit `86bd77156d` (clean sweep, no defect) onto this
worktree as `ac876967c3` (one trivial additive conflict in
`specs/pipeline/steps/index.js` — both this ticket and BL-1350, merged
just before it, added a different `require(...)` line; resolved keeping
both, confirmed by loading the registry with `node -e
"require('./specs/pipeline/steps/index.js')"`).

## Recovery note
This ticket's parcel was briefly mis-archived: `done_with_current.sh`
was called after finishing an unrelated QA merge-up note that was
batched alongside it, which (per the documented no-arg-takes-whole-batch
behavior) archived this git_handoff too before any work was done on it.
Recovered immediately in the same turn: the merge and every check below
were run for real, nothing here is retroactive paperwork over an
already-completed parcel.

## required_wiring / invariants re-verified
- `promote-exhaustion-to-failover!` confirmed called from
  `observe-pane-provider-outage!` in `handoffd.bb` (the live per-tick
  pane-observation path), not merely defined.
- Record shape matches `provider_outage_record_lib/normalize-record`'s
  expected fields — same store, no third path (BL-1178).
- All three declared invariants have a property test
  (`bl1335ExhaustionPromotionInvariants.property.test.js`), re-run here:
  3/3 pass.

## Babashka/no-tooling posture (engineering.prompt, Startup Tools)
This parcel's production code is entirely `.bb` (a new
`exhaustion_failover_promotion_lib.bb` plus a ~52-line addition to
`handoffd.bb`) and step-handler JS under `specs/pipeline/steps/` — no
Stryker/CRAP/DRY is wired for either surface. Gated by:
- `bb swarmforge/scripts/test/bl1335_exhaustion_promotion_test_runner.bb`
  — re-run here, ALL PASS.
- `bb -e '(load-file
  ".../swarmforge/scripts/handoffd.bb")'` — loads clean.
- `npx jscpd --config .jscpd.json` is TS-only (`"pattern": "**/*.ts"`) —
  N/A, no `.ts` files in this parcel's diff.

## Acceptance
`node specs/pipeline/cli.js
specs/features/BL-1335-token-exhaustion-opens-an-outage-record.feature`
— 6/6 pass, re-run here (not just trusted from the architect's evidence).

## BL-113 Gherkin soft mutation
The feature's only `Scenario Outline:` is scenario 02 (the false-positive
guard, 3 examples: transient network error / authentication rejection /
malformed model output). Ran
`specs/pipeline/scripts/run_gherkin_mutation.sh
specs/features/BL-1335-token-exhaustion-opens-an-outage-record.feature
<mktemp -d> specs/pipeline/steps/index.js soft`: **3/3 killed**, each via
the step's `unknown failure kind: <mutated text>` classifier rejection —
a keyed lookup, not shape-based, so this is mutation-tight. Manifest
stamp written into the feature file (kept, committed): 0 survivors, 0
errors. Temp work-dir was a fresh `mktemp -d`, deleted after the run —
never `.` (BL-1224 lesson).

## Property test
`npx vitest run --config vitest.properties.config.mjs
bl1335ExhaustionPromotionInvariants` — 3/3 pass, unchanged from
architect's pass. Reach and non-vacuity already confirmed by the
architect (three mutually exclusive corpora on invariant 1, real
consumer round-trip on invariant 2, both suppressing and 4
non-suppressing shapes on invariant 3) — re-read, no gap found.

## Standing whole-tree guards
Parcel touches `specs/pipeline/steps/` (new step file +
`index.js`) and adds a new `extension/test/` property test file. Ran all
17 `test/*Guard*.test.js` (excluding `.property.` siblings). Same 3
pre-existing, already-ticketed failures as BL-1350's own pass minutes
earlier (BL-1289/1290/1291) — confirmed by grep that none names any file
this ticket touches (`exhaustion_failover_promotion_lib.bb`,
`bl1335ExhaustionOpensFailoverRecordSteps.js`,
`bl1335ExhaustionPromotionInvariants.property.test.js`).

## Other checks
- `node out/tools/dependency-gate.js` — PASSED, no forbidden edges
  (repo-wide; architect already confirmed scoped + full-repo).
- `pgrep -fl 'node --test|stryker'` scoped to this worktree — clean, no
  leftover processes.

## Verdict
No defect found; no gap to close beyond what the architect already
verified. Forwarding to documenter.
