# BL-1318 hardener pass — 2026-09-01

Merged architect e66b5aaf65 into hardener worktree.

## Cooldown gate (BL-149), per changed file

- `specs/pipeline/steps/bl1318PackStaffingGateSteps.js` — `run` (quiet host, load 2.17/20 cores)
- `swarmforge/scripts/pack_staffing_gate_cli.bb` — `run`
- `swarmforge/scripts/pack_staffing_gate_lib.bb` — `run`
- `swarmforge/scripts/swarmforge.sh` — `skip-cooldown` (touched < 3 days ago; not
  mutation-tested this pass per the cooldown gate's own decision)

## BL-113 Gherkin acceptance mutation (Scenario Outline present)

`run_gherkin_mutation.sh` (all 4 positionals passed explicitly, `soft`) over
`specs/features/BL-1318-pack-launch-steward-staffing-gate.feature`:

```
mutants: 6, killed: 6, survived: 0, errors: 0 — outcome: pass
```

Embedded manifest confirms: `"Total":6,"Killed":6,"Survived":0,"Errors":0`.
Every Examples-column mutant (both `standing` and `failing_check` cells across
all 3 outline rows) was killed by the real generated acceptance test running
through the real step handler — this is a KEYED lookup
(`STANDINGS`/`KNOWN_FAILING_CHECKS` closed sets per the architect's evidence),
not a shape lookup, so the kill is genuine per the Scenario-Outline-shape-vs-key
rule.

## Pure lib and CLI (Babashka — no Stryker/CRAP/DRY wired, BL-472)

`pack_staffing_gate_lib.bb` and `pack_staffing_gate_cli.bb` are outside any
wired mutation tool. Reviewed the architect's already-run property test
(400 draws, 6 shapes, all three declared invariants encoded non-vacuously)
plus the unit test runner (28 assertions covering check-ordering,
hardener-gate competency override, revoked-human-priority, no-pin, unresolved,
every override combination) and judged coverage sufficient — no hand-authored
surgical sweep needed on top of what is already a thorough hand-written
suite exercising every branch of `seat-staffing-decision` and `resolve-seat`.

## CLI-level test present (2026-08-30 rule)

`test_pack_staffing_gate.sh` drives `pack_staffing_gate_cli.bb` directly
(argv in, stdout out) — 7/7, including the `NO_EVIDENCE` marker line and
invariant-2 (no registry write) check. Satisfies the CLI-wiring-test rule
without reintroducing the BL-233 CRAP trap (the lib stays pure, the CLI stays
a thin fs adapter).

## Standing whole-tree guards (parcel touches `specs/pipeline/steps/`)

Ran all six `extension/test/*Guard*.test.js` (excluding `.property.` lane):

```
Test Files  3 failed | 14 passed (17)
Tests       3 failed | 171 passed (174)
```

The 3 failures are **pre-existing, unrelated standing reds**, confirmed by
grep — none of the reported violating files belong to this parcel:

- `liveRepoDerivationGuard.test.js` — flags files under `extension/test/`
  unrelated to BL-1318.
- `socketFixtureShortRootGuard.test.js` — flags
  `bl1112StandingUnitRedsSteps.js` and `bl691AmbulanceWorkflowGapsSteps.js`,
  both pre-existing on `main` (BL-1112 itself is `backlog/done/`, filed
  specifically about "standing unit reds").
- `tempDirTrapGuard.test.js` — flags a list of `swarmforge/scripts/test/*`
  fixtures, none matching `pack_staffing_gate`.

Grepped all three violation lists for `bl1318`/`pack_staffing` — zero
matches. Per the BL-1063 rule ("a red outside your parcel is already
ticketed until proven otherwise"): these three guard files exist unmodified
on `main` and their violations predate this parcel; not this ticket's
regression, not re-ticketing.

## Verification re-run (all green, matches architect's report)

- `bb swarmforge/scripts/test/pack_staffing_gate_lib_test_runner.bb` — pass
- `bb swarmforge/scripts/test/bl1318_pack_staffing_gate_property_runner.bb` — 400/400, ALL PROPERTIES HOLD
- `bash swarmforge/scripts/test/test_pack_staffing_gate.sh` — 7/7
- `bash swarmforge/scripts/test/test_pack_staffing_gate_wiring.sh` — 7/7
- `node specs/pipeline/cli.js specs/features/BL-1318-pack-launch-steward-staffing-gate.feature` — 7/7

## CRAP / DRY

Not applicable — this parcel touches no `extension/src/*.ts`; CRAP/DRY are
scoped to that tree and this ticket's code is entirely `.bb`/shell/steps-js.

## Process hygiene

No orphaned `node --test`/stryker/gherkin-mutator processes after the pass
(`pgrep -fl` scoped check, clean). Mutation work dirs `./tmp/bl1318-mut*`
removed before commit.

## Verdict

Hardened. No mutants left surviving in the only lane this parcel's code can
be mutation-tested through (BL-113 Gherkin acceptance mutation); Babashka
pure lib already carries a non-vacuous 400-draw property suite the architect
verified encodes all three declared invariants. Forwarding to documenter.
