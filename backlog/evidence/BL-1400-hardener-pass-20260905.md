# BL-1400 hardener pass — clean sweep, forwarding

## Merged
Merged architect's `2517faf641` (clean sweep) into this worktree, ancestry
confirmed (`git merge-base --is-ancestor 2517faf641 HEAD`).

## Verified before hardening
- Unit: `checkFeatureHandlerRegistrationCli.test.js` **12/12** (baseline),
  `featureHandlerRegistrationCheck.test.js` **29/29** — no regression from
  the recursive `listTree` change.
- Property (`bl1400NestedHandlerIsSeen.property.test.js`): **2/2**.
- Shell fixture (`test_check_feature_handler_registration.sh`): **11/11**.
- Acceptance (`BL-1400-...feature`): **5/5**.

## Mutation (Stryker, scoped)
`npm run compile`, then a scoped run on the one changed compiled file:
`stryker run --mutate out/tools/check-feature-handler-registration.js
--testFiles test/checkFeatureHandlerRegistrationCli.test.js,test/featureHandlerRegistrationCheck.test.js`.

Scoping via `--testFiles` (not a custom vitest config) because Stryker's
dry run refuses to start on ANY failing test, and a plain `vitest run` on
this worktree carries **16 test files, 26 tests, pre-existing and already
ticketed** — confirmed unrelated to this ticket's diff (none touch
`check-feature-handler-registration.ts`, its tests, or the acceptance
files) and confirmed already tracked in `backlog/`:
`tempDirTrapGuard.test.js` (BL-872, standing), `pilotAcceptanceGate.test.js`
+ `crossFileDuplicationCheck.test.js` + `multiBranchParserCoverageCheck.test.js`
+ `perHatRolePromptEvidenceCheck.test.js` + `pilotScopedCrapCheck.test.js`
+ `shellEntryPointDriveCheck.test.js` + `unreachableStepHandlerCheck.test.js`
(BL-1221/BL-1229, pilot-gate deps stub gap — same
`checkOrphanedAuthoredDocs` shape across all seven), `pricingTable.test.js`
(BL-627, known-wrong rates), `socketFixtureShortRootGuard.test.js` (standing
red, gates nothing), plus `backendSwitch`, `constitutionDocCitations`,
`liveRepoDerivationGuard`, `operatorRuntimeBbFixtureClosure`,
`telegramClient`, `telegramCursorOperatorExec` (all pre-existing, `main`
and `origin/main` at parity per `git rev-list --left-right --count`, 0/0).
`--testFiles` limits which suites Stryker's dry run and mutant runs
execute without touching the shared vitest config any other run depends on.

First scoped run (before hardening): 33 killed, 2 survived, 32 NoCoverage
(49.25%/94.29% covered). Both survivors and every no-coverage mutant were
in code this ticket's diff either added or left untouched:

- **`.sort()` on `stepFiles` (NEW, BL-1400's own diff) — SURVIVED.** No
  existing fixture distinguished sorted from insertion order (all existing
  step-file fixtures were already alphabetical). Added
  `readTree returns stepFiles sorted, regardless of the tree walk's own
  order`, inserting a later-alphabetical name (`zLast.js`) before an
  earlier one (`aFirst.js`) so removing `.sort()` actually changes the
  asserted result. Killed after the fix.
- **`createFsIo.listTree`'s real-filesystem body (NEW, BL-1400's own diff)
  — 15 mutants NoCoverage.** Every existing test drives `readTree`/
  `checkFeatureHandlerRegistration` through a fake `io`; nothing exercised
  the real `fs.readdirSync(..., {recursive:true})` walk, its files-only
  filter, its relative-path `map`, or its catch-returns-`[]` fallback —
  this is the CLI thin-wrapper's real-IO adapter, only reached in-process
  by unit tests, per engineering.prompt (a subprocess/acceptance run scores
  0% in-process coverage, BL-233's trap). Added three real-mkdtemp tests
  (`mkTmpDir`, BL-743 convention): nested files at depth 0–2 are listed
  relative to the given dir; a directory entry and a symlink are
  discriminated (files+symlinks only); a missing directory hits the catch
  branch and returns `[]`. All three killed their targeted mutants.
- **`listDir`/`readFile`/`write` — remaining NoCoverage, left alone.**
  Pre-existing (BL-1303, `4073795d88`, confirmed via
  `git log -S -- <file>`), untouched by this ticket's diff — out of scope
  per the differential-complexity/changed-code-only convention.
- **The usage-string literal in `main()` — remaining 1 survivor, left
  alone.** Same pre-existing BL-1303 code, confirmed by the same blame
  check, not touched by this diff.

Re-run after both fixes: **49 killed, 1 survived (the pre-existing usage
string above), 17 NoCoverage (pre-existing listDir/readFile/write) —
73.13%/98.00% covered**. Every mutant in code this ticket added is now
killed or has real-fs coverage.

## BL-113 Gherkin mutation (Scenario Outline, scenario 3)
`run_gherkin_mutation.sh` on the one Outline
(`nested-helpers-are-not-offenders-03`, 2 examples), `soft`, work-dir a
fresh `mktemp` under `./tmp/` (never `.`, never the repo). Pre-check per
the BL-788/BL-921 cross-step leak rule: the fixture step
("the registration guard examines the tree") wraps `buildRepo`+`runGuard`
in a single `try/finally` with `fs.rmSync`, no bridge start/stop anywhere
in the step file — clean.

Result: **2/2 killed** (both example-value mutations on `<relation>`).
Embedded manifest committed in the `.feature` file
(`scenario_hash` ...962b2ad, `mutation_count: 2`, `result: {Total:2,
Killed:2, Survived:0, Errors:0}`).

## CRAP
`npm run coverage` failed the write on the same 16 pre-existing unrelated
reds; re-ran with `--coverage.reportOnFailure=true` (Vitest 3.2.6, real
option, unset in this repo — per the standing rule for this exact
situation). `node scripts/crapReport.js src/tools/check-feature-handler-registration.ts`:
every function <= 6 (`listTree` new: complexity=2, coverage=100%,
CRAP=2.00; the one complexity=2/coverage=0%/CRAP=6.00 anonymous closure is
`listDir`'s pre-existing catch/filter, at the threshold, not over it, and
untouched by this diff).

## DRY
`jscpd` over the changed TS file, its own test file, and the acceptance
step handler: **0 clones**.

## Cleanup
No orphaned `node --test`/`stryker` processes (checked before and after).
Scratch Stryker-vitest config and the Gherkin-mutation work-dir (both
under this worktree's `./tmp/`, never `/tmp` or the repo) removed before
handoff. Left every pre-existing `.aside`/scratch file under
`extension/tmp/` untouched (not mine to delete — Clean Up After Yourself).

## Forwarding
To documenter, priority `00`, same task name, this commit forwarded.
