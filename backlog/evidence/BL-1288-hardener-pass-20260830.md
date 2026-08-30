# BL-1288 — hardener pass

Commit reviewed: 5d1529fa62 (architect, clean pass, forwarded from d1a584966c).

## Scope

`swarmforge/scripts/master_main_reconcile_lib.bb` (`push-rejection?` /
`rematch-with-push-first!`), the acceptance step handler
`specs/pipeline/steps/bl1288PushFailureClassificationSteps.js` and its CLI
driver `specs/pipeline/steps/lib/bl1288PushFailureClassificationCli.bb`, the
property test `extension/test/bl1288OnlyRejectionDiscardsInvariants.property.test.js`.
No `extension/src/**` changes in this ticket, so Stryker has nothing new to
mutate (confirmed: `git log --oneline bfbbc4eeb0..5d1529fa62 -- extension/src`
is empty).

## Cooldown gate (BL-149)

- `swarmforge/scripts/master_main_reconcile_lib.bb` → `skip-cooldown`
  (2.18 days old, cooldown 3 days). No Stryker exists for `.bb` anyway
  (engineering.prompt Startup Tools); this is the note for the record.
- The two BL-1288 step/CLI files → `run` (host quiet, load avg 2.04/20 cores).

## Checks run

- `specs/pipeline/scripts/run_acceptance.sh` on the ticket's feature file →
  5/5 green (real git fixtures, no network — `.invalid` host / refused
  localhost port).
- BL-113 soft Gherkin mutation on the Scenario Outline (3 examples ×
  cause/fate = 6 mutants) → **6/6 killed**, manifest embedded
  (`sha256=56676ff6...`). No survivors, no equivalents.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` →
  ALL TESTS PASS (before and after the added tests below).
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb` →
  ALL PROPERTIES HOLD, 500 runs, including the BL-1288 non-vacuity check
  ("a mutant that always resets regardless of push success is flagged").
- `npx vitest run test/bl1288OnlyRejectionDiscardsInvariants.property.test.js
  --config vitest.properties.config.mjs` → 3/3 passed. Uses `mkTmpDir` (BL-743
  compliant).

## Hand-authored mutation sweep of `push-rejection?` (BL-638 fallback — no
mutation tool wired for `.bb`)

`push-rejection?` is `(and A (or B C))`. Probed by hand-mutating the compiled
source in place (no detached job outstanding at the time), running the bb
test runner, then restoring from a pre-edit copy:

- `and` → `or` on the outer clause: **SURVIVED** against the pre-existing
  suite — every negative test case happened to lack both `"non-fast-forward"`
  and `"fetch first"` substrings, so nothing distinguished "rejection marker
  present" from "rejection marker absent, but one of the two divergence words
  appears anyway" (e.g. an advisory hint line quoting `non-fast-forward`
  without git having actually rejected the push). **Real gap — fixed.** Added
  two discriminating cases to the test runner (`non-fast-forward` alone,
  `fetch first` alone, both with no `! [rejected]` marker, both expected
  `false`); verified they pass against real code and fail against the `or`
  mutant, then restored the mutant back to the original source (`git status`
  clean on the library file after restore).
- Inner `or` → `and`: **killed** — the existing `` `! [rejected] ... (fetch
  first)` `` positive case has no `"non-fast-forward"` substring, so
  requiring both would flip it to `false` and the existing assertion catches
  it. No change needed.
- `"non-fast-forward"` → a non-matching literal: **killed** by the existing
  positive fixture for that branch. No change needed.

Net: one real survivor found and closed with two new unit assertions
(`swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`).

## Whole-tree standing guards (parcel touches `specs/pipeline/steps/` and
`extension/test/`)

Ran all 17 non-property `test/*Guard*.test.js` files. 3 failed:
`tempDirTrapGuard`, `socketFixtureShortRootGuard`, `liveRepoDerivationGuard`.
None names any `bl1288*` file — confirmed by grep. All three are pre-existing
standing debt already ticketed and paused:

- `tempDirTrapGuard` → BL-1289 (`a-temp-root-is-always-cleaned-up`)
- `socketFixtureShortRootGuard` → BL-1290
  (`a-socket-fixture-is-rooted-short-enough-to-bind`), violators
  `bl1112StandingUnitRedsSteps.js` / `bl691AmbulanceWorkflowGapsSteps.js`
- `liveRepoDerivationGuard` → BL-1291 (`a-live-repo-read-is-pinned-or-justified`)

Per the BL-1063 "a red outside your parcel is already ticketed" rule: not
reported as new, not blocking this forward.

## Orphan check

`pgrep -fl 'node --test|stryker'` clean before and after. No leaked tmp dirs
under `/tmp` matching `bl1288*`, no leaked tmux sockets. `git status --short`
clean apart from the two intentional edits below.

## Verdict

Hardened. Forwarding to documenter, task
`BL-1288-only-a-rejected-push-authorises-discarding-local-commits`.
