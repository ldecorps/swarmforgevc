# BL-1192 / BL-1211 hardener pass — 2026-08-28

Batch of two: `git_handoff` from architect for BL-1192 (`d54971de16`, already
an ancestor of this worktree's HEAD from a prior pass) and BL-1211
(`39b6d2c8d6`, merged this pass with `git merge --no-ff`).

## Session-start incident, unrelated to either ticket's own defect

Before any hardening work, `ready_for_next.sh` reported worktree drift on
`docs/briefings/.sent.json` — this turned out to be the ambient
`GIT_DIR`/`GIT_WORK_TREE` env-leak hazard (already known from a prior
cleaner-session incident) hijacking git commands to operate on the shared
`main` checkout instead of this worktree. Fixed by prefixing every git
invocation with `env -u GIT_DIR -u GIT_WORK_TREE`. A worse consequence was
then discovered while debugging BL-1192's own test runner failure: a
babashka git-fixture debug script, run under the same hijacked env, landed
11 junk commits directly onto the shared `main` branch and overwrote the
local `refs/remotes/origin/main` tracking ref via a fixture's own
`update-ref` call (task_scope_gate_lib_test_runner.bb's
`mark-origin-main-here!`). Repaired: `git reset --hard` on `main` back to
its pre-corruption tip (`d25c04156`, confirmed via timestamps that no other
work had landed on top in the ~1-minute corruption window), then
`git fetch origin main` to restore the tracking ref from the real remote.
Confirmed the real GitHub remote was never touched (no push was run).
Recorded as a new memory entry
(`ambient-git-env-leak-corrupts-shared-main-via-bb-fixture-update-ref.md`)
since the blast radius here is materially worse than the prior recorded
incident. With the env fixed, `task_scope_gate_lib_test_runner.bb` passes
clean (`ALL PASS: task_scope_gate_lib.bb`) — the seven failures seen before
the fix were entirely this env hijack, not a defect in BL-1192's gate.

## BL-1192 (pre-handoff task-scope gate)

Already merged at HEAD when this pass started. Re-verified with a clean env:
- `task_scope_gate_lib_test_runner.bb`: ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on
  `BL-1192-pre-handoff-task-scope-gate.feature`: 8/8 pass.

No further hardening needed; forwarding unchanged.

## BL-1211 (quarantine-lift / recovery-filter CLIs, architect D1 re-fix)

Existing coverage (`bounceResurrection.test.js`, 12 tests covering scenarios
01-05 plus the D1 fail-open/fail-closed contrast) was solid, but the two new
operator-facing CLI wrappers this pass's merge added
(`quarantine-lift-check.ts` / `recovery-filter-check.ts`, and their
`*CliArgs.ts` flag parsers) were exercised ONLY via
`bl1211QuarantineLiftAuthorshipSteps.js` driving the COMPILED CLI as a
subprocess (scenarios 06-08) — zero in-process coverage of `parseArgs` or
`main()`, the CLI-entrypoint CRAP trap (hardener.prompt).

Added `extension/test/bl1211OperatorCli.test.js` (11 tests): every
`parseArgs` branch for both CLIs (missing each required flag, unknown `--by`
role, unknown flag, empty `--paths`, a `--paths` value that splits into
nothing but empty segments) plus `main()` driven in-process against a real
git fixture (granted/refused/usage-failure for both CLIs). Used the shared
`copySeededRepoInto` fixture, not a raw `git init` — the whole-tree
`repoCreationGuard.test.js` D4 check caught the first draft using a raw
`git init` and was the reason to switch.

Added one test to `bounceResurrection.test.js` for a genuine coverage gap in
`gatherBounceResurrectionFacts`: the "bounced commit deleted this path -
nothing to resurrect" branch (line ~145) had never been exercised — every
existing fixture's bounced commit ADDED or MODIFIED content, never deleted
it outright.

CRAP: the merge's new/changed functions in
`extension/src/{tools,metrics}/*.ts` initially had 4 functions over the <=6
threshold (`recoveryFilterCliArgs.ts::parseArgs` complexity=12,
`quarantineLiftCliArgs.ts::parseArgs` complexity=8,
`bounceResurrectionGitAdapter.ts::findAuthoredBackBy` complexity=8/coverage
85%, `::gatherBounceResurrectionFacts` complexity=6/coverage 93%). At 100%
coverage CRAP floors at the raw complexity number, so coverage alone could
not clear the two `parseArgs` functions or `findAuthoredBackBy` — extracted
behavior-preserving helpers (a flag-name lookup table replacing each
if/else-if chain; `authorshipAt`/`pipelineRoleTrailer` split out of
`findAuthoredBackBy`; `hasRequiredStrings`/`nonEmptyPathList` split out of
`recoveryFilterCliArgs.ts`'s validation). `gatherBounceResurrectionFacts`
reached CRAP<=6 once the new delete-path test raised its coverage to 100%.
All five files now CRAP<=6 (`node scripts/crapReport.js` exits 0).

jscpd on the five touched files reports one small clone pair (24 lines,
7.48% tokens) between `quarantineLiftCliArgs.ts` and
`recoveryFilterCliArgs.ts` — the two files deliberately mirror each other's
shape (the ticket's own note: "Mirrors quarantineLiftCliArgs.ts's shape").
Not extracted further: the same bare for-loop flag-parsing shape appears in
~52 other `src/tools/*.ts` CLIs repo-wide with no shared helper, so
extracting one here would be inconsistent with the rest of the codebase and
belongs to a dedicated repo-wide ticket, not a two-file side effect of this
pass.

Verification: `npm run compile` clean; `npx vitest run --coverage
test/bl1211OperatorCli.test.js test/bounceResurrection.test.js
test/gitEnvGuard.test.js` — 29/29 pass; BL-1211 acceptance feature 8/8 pass
(fresh compile first, per BL-497). No property-test lane touched by this
parcel.

## Pre-existing, out-of-scope red found while running the standing whole-tree
guards (2026-08-19 rule, since this pass touched `extension/test/`)

`tmpDirMigrationGuard.test.js`, `tempDirTrapGuard.test.js`, and
`socketFixtureShortRootGuard.test.js` each fail one whole-tree scan test,
all on files this parcel never touched (`agentNotesCore.test.js` and
~14 other `extension/test/*.test.js` files with raw `mkdtemp`;
`swarmforge/scripts/{,test/}*` with no EXIT trap/shutdown hook; two
`specs/pipeline/steps/*Steps.js` files rooting a socket fixture at
`os.tmpdir()`). Confirmed present on `origin/main` already
(`git show origin/main:extension/test/agentNotesCore.test.js` has the same
raw `fs.mkdtempSync` calls) — not introduced by this pass. `repoCreationGuard.test.js`'s
own D4 check (my new test file's first draft) WAS caused by this pass and
was fixed (see above). Not filing a new ticket for the pre-existing three —
BL-1226 (mkdtemp-convention-gate-covers-step-handlers, paused) and BL-1209
(mkdtemp-check module-resolution defect, paused) are adjacent but neither
is an exact match for "the whole-tree scans themselves are red against
files nobody touched this session"; flagging here per the BL-1063 "report,
don't silently absorb" discipline rather than minting a possible duplicate.

By hardender.
