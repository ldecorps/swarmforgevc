# BL-1304 Hardener Pass — 2026-09-01

## Ticket
BL-1304: expedite --dry-run walks into the real stage launcher

## Reviewed commit
b4510cd6d4 (architect forward, PASS)

## Scope
Babashka-only change (`swarmforge/scripts/expedite_cli.bb`) plus step file
`specs/pipeline/steps/bl1304DryRunSpawnsNothingSteps.js`. Per
engineering.prompt Startup Tools, Babashka has no mutation/CRAP/DRY tooling
wired (BL-472 deferred) — gated only by its own unit-test suite. This pass
records the degraded fallback; no mutation/CRAP/DRY tool ran over this code.

## Property test (real fixture, real CLI — `extension/test/bl1304DryRunSpawnsNothing.property.test.js`)
Run via `npx vitest run --config vitest.properties.config.mjs
test/bl1304DryRunSpawnsNothing.property.test.js` — 3/3 pass:
- invariant 1: no stage started, no worktree/branch created, no backlog move,
  across worktree-present/absent x ticket-placement x bounce-bound draws
- invariant 2: dry run succeeds and prints a plan whenever a real run could
  start
- reach floor (non-vacuity): without `--dry-run`, the same fixture DOES
  start stages and reaches QA — proves the generator's "worktree already
  exists" state is a real reachable precondition, not a state the property
  never sees.
No fixture leak: `mkTmpDir` prefix `bl1304-prop-` dirs under the host tmp
root all predate this run (04:05–05:22Z, from an earlier interrupted
hardener pass, not created or cleaned by me) — my own run's afterEach sweep
left no new litter. Not mine to remove per "never delete what you did not
create"; noted for whoever owns that earlier session's cleanup.

## Acceptance (BL-1304-a-dry-run-spawns-nothing.feature)
`specs/pipeline/scripts/run_acceptance.sh` — 4/4 pass.

## BL-113 Gherkin acceptance mutation (soft)
Already present in the worktree from an earlier, interrupted pass at this
ticket's current feature text (mutation-stamp `e50ab4a7…`, manifest embedded
in the `.feature` file): scenario "a dry run starts no stage, whatever an
earlier run left behind", 2/2 mutants Killed, 0 Survived, 0 Errors.
Re-confirmed live by re-running acceptance (4/4 pass) — feature text
unchanged since the stamp was written. Committing that manifest as part of
this pass.

## Standing whole-tree guards (parcel touches specs/pipeline/steps/)
Ran all 16 `test/*Guard*.test.js` files (excluding `.property.` siblings).
3 failed, all pre-existing and unrelated (same three as BL-1316's pass in
this same batch — see `BL-1316-hardener-pass-20260901.md` for detail):
`tempDirTrapGuard`, `socketFixtureShortRootGuard`, `liveRepoDerivationGuard`,
each already ticketed (BL-1289/BL-1290/BL-1291). Confirmed via grep neither
violation list names `bl1304DryRunSpawnsNothingSteps.js` or any file this
ticket touches. No bounce.

## Orphan/process check
`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean before and
after.

## Verdict
Hardened. Forward to documenter.

By hardener.
