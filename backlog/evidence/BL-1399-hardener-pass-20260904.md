# BL-1399 — hardener pass, 2026-09-04

Merged coder commit `01c2590744` directly (no cleaner/architect/documenter
stage — the ticket's own `stage_skip_reasons` declares
`required_stages: [coder, hardender, qa]`: cleaner skipped as "one env var
added to one fixture helper; nothing to de-duplicate", architect skipped
as "no design: the guard's own FRESHNESS_REQUIRED seam is used as
documented at its line 8", documenter skipped as "no document describes
this fixture; the seam is already documented in the guard's header").
Clean merge, no conflicts (`handoffd.bb` and `suite-manifest.tsv`
auto-merged, both carrying unrelated BL-1395/BL-1398 sibling work from the
same coder session, per this session's established bundling pattern).

## Own note: confirmed `handoffd.bb`'s `load-file` probe is now safe

This merge also brought in BL-1395's structural fix (retiring
`handoffd.bb`'s bare `(-main)` for the `babashka.file` guard idiom, so a
`load-file` probe analyses the WHOLE file instead of exiting a few forms
in on `usage`) — directly downstream of my own earlier
`BL-1392-hardener-critical-fix-handoffd-load-crash-20260904.md` finding.
Confirmed: `bb -e "(load-file ...)"` now exits 0 with NO output (previously
printed "Usage: handoffd.bb <project-root>" and exited after a few forms —
the old, unsafe partial-analysis behavior). This is the correct, intended
new behavior, not a regression.

## Checks re-run, all independently

- `test_bl1399_freshness_fixture_own_registry.sh` — 6/6 ALL PASS (the
  checker's own registry-agreement, live-vs-fixture isolation, missing-
  daemon refusal, live-list refusal-untouched, live-files-unmodified, and
  `bl1012FreshnessSelfInflictedIncidents` green checks).
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1012FreshnessSelfInflictedIncidents.property.test.js
  test/bl1399FreshnessFixtureOwnRegistry.property.test.js` — 6/6 passed
  (the previously-red BL-1012 suite is now green, plus BL-1399's own two
  new invariant properties).
- `run_acceptance.sh` on the BL-1399 feature — 3/3 pass.
- `check_feature_handler_registration.sh` — rc 0.
- required_wiring anchors grepped directly: `FRESHNESS_REQUIRED` present
  in `bl1012FreshnessSelfInflictedIncidents.property.test.js` (multiple
  sites including the checker's env); `registerSteps` exported from
  `bl1399FreshnessFixtureOwnRegistrySteps.js:58/109`.
- `check_bb_scripts_load.sh` (BL-1395's new commit-path guard) — clean:
  "0 changed Babashka script(s) analysed, handoffd booted - all clean."

## Property test quality read

Read `bl1399FreshnessFixtureOwnRegistry.property.test.js` directly rather
than trusting the coder's own claim of non-vacuity:
- Invariant 1's registry is CONSTRUCTED as a genuine non-empty subset of
  the fixture's own conf daemons (`chosen`, drawn via `pick`/`size`) — not
  a fixed list, so agreement is proven by construction across the fuzzed
  range, not by luck on one hand-picked case.
- Invariant 2's "missing" set is derived from the LIVE required list
  filtered against the fixture's own daemons, with an explicit
  non-vacuity assertion (`missing.length > 0`) that fails loud if the live
  list ever stops naming anything absent from the fixture — the exact
  "assert nothing on the other side of the check" trap this session's
  testing discipline calls out, closed here rather than left open.
- The drawn missing daemon is asserted to actually appear in the guard's
  refusal output, not merely that SOME refusal happened.

## No production code in this ticket's own scope — mutation N/A

`git diff --name-only b7bfd08199..01c2590744` scoped to BL-1399's own
files touches only `extension/test/bl1399FreshnessFixtureOwnRegistry.property.test.js`,
its step handler, its e2e shell wrapper, and doc/backlog bookkeeping — no
`.bb`/`.sh` PRODUCTION file. The coder's own e2e check 4 (re-verified
above) confirms the live guard, conf and registry are byte-unmodified.
Nothing here for the BL-149 gate or a hand-authored mutation sweep to
target; `mutation_cost: low` in the ticket YAML is consistent with that.

## BL-113 Gherkin mutation

`grep -c "Scenario Outline"` on the feature: 0 — inapplicable per BL-638.

## CRAP / DRY

No `extension/src` file in this ticket's own diff. N/A.

## Process / fixture hygiene

No orphaned `node --test`/mutation processes. No `GIT_DIR` leaked into
this session's environment (checked directly, given BL-1395's own
narrative about a leaked `GIT_DIR` corrupting a sibling ticket's fixture
this same day). Clean working tree.

## Result

A pure test-fixture fix with no production-code surface to harden;
re-verified the e2e, both property suites (including the now-green
previously-standing-red BL-1012 suite), acceptance, and both
required_wiring anchors, and read the new property test directly to
confirm its generator reach and non-vacuity assertions are genuine.
Forwarding directly to QA per the ticket's own declared stage skip
(documenter also skipped).

By hardender.
