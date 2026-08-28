# BL-1205 — architect bounce — 20260828

## D1: acceptance step handler leaks its git fixture directory every run

**File:** `specs/pipeline/steps/bl1205HandoffRefusesAMassDeletionForwardSteps.js`

**Commit reviewed:** `0666e82db4` (cleaner's pass, merged into architect
worktree as `f28...` [see this parcel's merge commit]).

**Defect:** `ctx.root = mkTmp('bl1205-tree-collapse-')` (line 112) creates a
real 200-file git repo under `os.tmpdir()` in the Background step. No step
in this file, and no `finally`/`afterEach`-shaped hook, ever removes
`ctx.root`. Every scenario run — 9 scenarios in this feature alone, more on
every CI/local acceptance pass — leaks one fixture directory permanently.

This is exactly the shape the project's own engineering guardrail names:
"A fixture dir from `fs.mkdtempSync` is removed in a `finally`, never only
after the last assertion — a throw or bounce otherwise leaks it forever"
(engineering.prompt, BL-971).

**Confirmed live, not theoretical:** running
`bash specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1205-handoff-refuses-a-mass-deletion-forward.feature`
once (9/9 scenarios pass) left 18 `bl1205-tree-collapse-*` directories in
`/tmp` afterward (cleaned up by this bounce; not left in place).

**Not a re-report of a standing ticket:** grepped
`backlog/` for both this file's name and its named precedent
(`bl760DuplicateChainGuardSteps.js`, which the coder's own commit message
cites as "same pattern as") — neither the leak nor a tracking ticket for it
appears anywhere in the backlog. `bl760...Steps.js` has the identical leak
(no cleanup of its own `mkTmp` root either) but is already-shipped,
out-of-parcel code; this bounce is about the NEW file this parcel
introduces, which repeats rather than fixes the shape.

**Remediation:** wrap the Background's fixture-root lifetime in a
`finally` (or the scenario's own terminal `Then` steps, matching the
`cleanupFixtureState`-in-`finally` pattern `bl1213ParcelRollbackGuardSteps.js`
already uses in this same directory) so `fs.rmSync(ctx.root, {recursive:
true, force: true})` runs on every scenario exit, pass or fail.

## Everything else checked — clean (Article 4.4 full inventory)

| Check | Result |
|---|---|
| Dependency gate (`extension/out/tools/dependency-gate.js`) | N/A — no `extension/src/**` files touched by this parcel |
| Co-change report | No new suspected coupling; `swarm_handoff.bb` <-> `index.js`/`handoffd.bb` coupling is pre-existing (every prior gate in this chokepoint touches both) |
| `tree_collapse_guard_lib_test_runner.bb` | ALL PASS |
| `bl1205_tree_collapse_guard_property_runner.bb` | 2000 runs, ALL PROPERTIES HOLD, non-vacuity proven by hand-mutation (documented in the runner's own header) |
| Declared invariant 1 (no hop exempt, no ticket id required) | Encoded structurally (`findings-for-git-handoff` takes no task-name param) + generative property over `mass-deletion?` |
| Declared invariant 2 (guard never writes) | Encoded via source-grep for write-shaped git verbs in the property runner |
| Declared invariant 3 (unreadable facts warn, never block) | Encoded directly (`before <= 0` cases) + generative fuzzing |
| `npm run compile` | Clean |
| Acceptance (`run_acceptance.sh` on the BL-1205 feature) | 9/9 pass |
| `swarm_handoff.bb` wiring | Correct: fires for every `git_handoff` recipient, no ticket-id gate, fail-open warning posture matches the four existing gates |

Only D1 blocks. The underlying gate logic and its wiring are solid and
well-verified.

By architect.
