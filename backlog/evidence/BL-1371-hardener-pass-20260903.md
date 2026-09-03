# BL-1371 — hardener pass, 2026-09-03 (expedite run, stage 04)

Reviewed commit `724ef8f714` (architect, PASS, no violation). Load quiet
throughout (`uptime` 0.20–0.24 on 20 cores); no leftover
`node --test`/`stryker` processes before or after this pass.

## Scope: the parcel's actual diff, not the whole file

`featureHandlerRegistrationCheck.ts`'s diff (`git diff main...HEAD`) touches
only two things: the new `isDiscovered`/`discoveredHandlers` functions and
the seeding loop in `walkRegistry`. `dedupeAndSortOffenders`,
`collectUnregisteredHandlers`, the `KIND_ORDER` array and the top-level
`handlers` filter are byte-identical to `main` — confirmed by diff, not
assumed — and are the cleaner's already-recorded pre-existing debt (130
mutation sites, over threshold before this parcel's +21 too). Hardening this
pass targets the new/changed surface, per this stage's own scoping.

## Mutation — TypeScript (Stryker, scoped)

Full-suite Stryker dry runs on this tree fail before reaching any mutant, on
THREE unrelated, pre-existing, environment/state-dependent reds (none
touched by this parcel, confirmed by `grep`/`git log`):
`liveRepoDerivationGuard.test.js` (BL-1038, red since 2026-08-22),
`telegramCursorOperatorExec.test.js` (BL-698's ambulance test — worktree
backlog state has BL-698 in `done/`, not `active/`), and
`socketFixtureShortRootGuard.test.js` (the known-standing socket-fixture-root
red already in memory as gating nothing). Excluded those three files from a
worktree-local temp vitest config (`extension/tmp/vitest.stryker-hardener*`,
never committed, removed at end of pass) and used `--testFiles` to scope the
dry run to this module's own dedicated unit tests, per Stryker's documented
use of that flag ("verify a module's dedicated unit tests can kill its
mutants independently").

- `featureHandlerRegistrationCheck.js`, scoped to `isDiscovered`/
  `discoveredHandlers`/the seeding loop: 2 survivors found, both in the new
  `isDiscovered` guard (`stepFile.startsWith(prefix) &&
  !stepFile.slice(prefix.length).includes('/')` — ConditionalExpression
  `return true` and LogicalOperator `&&`→`||`). Root cause: the shared
  `tree()` test helper's `stepFiles` regex
  (`/^specs\/pipeline\/steps\/[^/]+\.js$/`) can never produce a nested
  `stepFiles` entry, so no existing fixture ever drove `isDiscovered` with a
  path that satisfies `startsWith(prefix)` but fails the second half. Added
  `test/featureHandlerRegistrationCheck.test.js`: "a *Steps.js file nested
  one level under steps/ is not auto-discovered" — a raw (non-`tree()`)
  fixture listing a `steps/sub/bl9999NestedSteps.js` in `stepFiles`,
  asserting it is reported `unregistered-handler` (i.e. NOT auto-discovered).
  Re-run: both mutants killed, 27 survivors remain, all in the untouched
  pre-existing code identified above (KIND_ORDER strings, dedupe/sort,
  the top-level REGISTRY_PATH filter) — none added by this parcel.
- `featureHandlerRegistrationTypes.js` (decision `run` per the BL-149
  cooldown gate, file age 3.47–3.50 days): Stryker reported 4/5 exported
  constants (`REGISTRY_PATH`, `STEPS_DIR`, `LIB_DIR`, `FEATURES_DIR`)
  Survived at 20% score, with every test showing `covered 0` — a static
  mutant coverage-attribution artifact of this tool/environment, not a real
  gap. Verified per the BL-1015-class re-measurement rule: hand-patched each
  literal to `''` directly in `out/tools/featureHandlerRegistrationTypes.js`
  and ran the real test files (`featureHandlerRegistrationCheck.test.js`,
  `checkFeatureHandlerRegistrationCli.test.js`,
  `bl1371StepDiscovery.test.js`) directly — all 4 mutants caused real,
  immediate test failures (5, 5, 4, 3 failing tests respectively). Confirmed
  with `--concurrency 1` and `coverageAnalysis: "all"` too; Stryker still
  reported all 4 Survived. This is a tooling/sandbox false reading, not a
  test gap — restored the file (`diff` confirmed byte-identical to
  pre-mutation) before continuing. `HANDLER_SUFFIX` was correctly killed by
  the existing literal-agreement test (BL-897).

## Gherkin mutation (BL-113)

The feature has 5 plain `Scenario:` blocks and no `Scenario Outline:` /
`Examples:` — `run_gherkin_mutation.sh ... soft` correctly reports
`outcome: "inapplicable"`, `Total: 0` (BL-638), and wrote the manifest stamp
into the feature file (matches the convention already present in 380 other
feature files in this repo). Not a substitute for hardening — see the
hand-authored sweep below.

## Hand-authored sweep — `specs/pipeline/steps/bl1371StepDiscoverySteps.js`

Not TypeScript (out of Stryker's `out/**/*.js` scope) and its feature has no
Scenario Outline (out of BL-113's scope), so per the BL-638 fallback:
hand-mutated the comment-stripping regex in the "no file another ticket also
edits" Then-step (`registrySource.replace(/\/\*.../).replace(/\/\/.../)` →
bare `registrySource`) and re-ran the BL-1371 acceptance feature: 4/5 pass,
1 fail — the mutant is caught (without stripping, the header's own quoted
`require('./blNNNSteps')` explanation would match the require-line regex and
correctly fail the assertion the coder wrote specifically to guard against
that false match). Restored, confirmed byte-identical via `diff`. The rest
of this file is already written defensively against the vacuity traps this
prompt warns about — explicit "skipped by NAME would make this scenario
vacuous" and "two runners that both loaded nothing... would agree while
being wrong" comments/assertions are already in place — read but not
further mutated given the confirmed catch above and the time budget for an
expedited pass.

## Verification run this pass

| Check | Result |
|---|---|
| `npx vitest run` (3 dedicated unit files) | 46/46 pass (was 45; +1 new isolating test) |
| `npx vitest run --config vitest.properties.config.mjs` (2 property files) | 6/6 pass, same reach floors as architect's pass (P1 120, P2 120, P3 120) |
| `npx vitest run` (full unit lane) | 9901/9926 pass, 25 fail in 15 files — same standing-red set the coder/cleaner already baselined (+1 vs their 9900, from the new test) |
| `node scripts/crapReport.js` (scoped to the two touched `src/*.ts`) | every function CRAP ≤ 6.00, 100% coverage, `isDiscovered` at 4.00 |
| `swarmforge/scripts/test/test_check_feature_handler_registration.sh` | 9/9 PASS |
| `run_acceptance.sh` BL-1371 feature | 5/5 pass |
| `jscpd` over touched TS files | 0 clones |
| Orphaned `node --test`/`stryker` processes | none before or after |

## Verdict

PASS. Both real mutation gaps found (the new `isDiscovered` guard's two
surviving TS mutants) are closed with a genuinely isolating test. The
`featureHandlerRegistrationTypes.js` Stryker survivors are a confirmed false
tooling reading, not a gap — verified by direct hand-mutation against the
real compiled file and real test run, per the BL-1015-class re-measurement
discipline. CRAP holds at ≤6.00 on all touched functions. Forwarding to
documenter.
