# BL-1294 — cleaner pass

Commit: this parcel · 2026-09-02 · worktree `cleaner`

## Verdict: NONE — no cleanup defect found

Merged coder's `1a66f717c3` (merge commit `bfcc3b1e6f`) and reviewed
`extension/test/helpers/pinnedRepoFixture.js` end to end against the
cleaner checklist.

## Checklist run

- **Coverage of changed behavior**: `extension/test/pinnedRepoFixture.test.js`
  (16 tests, includes the rewritten BL-1294 dependency-throw test) and the new
  `extension/test/bl1294FixtureClosurePathAndFailureInvariants.property.test.js`
  (2 property tests, non-vacuity measured by the coder) — all green.
- **CRAP / DRY**: not applicable — no `src/**/*.ts` files touched (jscpd/CRAP
  scope is `src`); the changed file is test infrastructure
  (`extension/test/helpers/`).
- **Mutation-site size (BL-485)**: `node extension/out/tools/mutation-site-count.js
  extension/test/helpers/pinnedRepoFixture.js` → 101 sites, `over` (threshold
  100). Weighed as a split candidate and declined: the file is one cohesive
  mechanism — `loadFileDeps` → `resolveDepPath` → `resolveScriptClosure` →
  `copyScriptClosure` → `copyLiveScriptClosureInto`, each stage built directly
  on the one before it and already separated internally (pure resolver vs.
  I/O-touching copy, per the module's own architecture). A mechanical file
  split at 1% over threshold would only fragment one mechanism across files
  without improving structure or separation of concerns — the explicit
  "stays whole" case in the cleaner role's own guidance.
- **Module structure / boundaries / encapsulation**: resolver functions
  (`loadFileDeps`, `resolveDepPath`, `resolveScriptClosure`) are pure over an
  injected reader; only `copyScriptClosure`/`copyLiveScriptClosureInto` touch
  `fs`. High-level policy (closure resolution) is already independent of I/O.
  No boundary leak found.
- **Mutation hardening**: coder's evidence
  (`backlog/evidence/BL-1294-coder-pass-20260902.md`) shows the new throw
  branch TDD'd against the parent commit (failed red, then green) and both
  declared invariants non-vacuously measured (reverted the fix, confirmed the
  property catches the regression). No further weakly-covered changed
  behavior found.

## Regression check

- `pinnedRepoFixture.test.js` (16/16), the new property file (2/2),
  `telegramFrontDeskBotCli.property.test.js` (3/3, incl. BL-1203 invariant 1
  — the original incident), `telegramFrontDeskBotCli.test.js` (271/271), and
  the BL-1294 acceptance feature (4/4 scenarios via `specs/pipeline/cli.js`)
  all green.
- Registered step handler confirmed:
  `specs/pipeline/steps/index.js` requires
  `bl1294FixtureScriptClosurePreservesDependencyPathsSteps` (required_wiring
  anchor satisfied).
- Full `extension` vitest run has 25 pre-existing failures across 15 files
  (`pilotAcceptanceGate.test.js` and friends — a systemic
  `checkOrphanedAuthoredDocs is not a function` TypeError —, plus unrelated
  hand-maintained-list drift in `operatorRuntimeBbFixtureClosure.test.js` and
  `tempDirTrapGuard.test.js`). None touch `pinnedRepoFixture.js`, none are in
  this parcel's diff, and none regressed by this merge — confirmed by
  inspecting each failing file's own dependencies (no reference to
  `pinnedRepoFixture` or this ticket's changed files). Pre-existing, out of
  scope for this ticket.

## No cleanup commit needed

Coder's implementation already meets the cleaner checklist — small, cohesive,
well-tested, correctly bounded I/O/logic split. Forwarding the merge commit
with this NONE evidence per Article 4.4.

By cleaner.
