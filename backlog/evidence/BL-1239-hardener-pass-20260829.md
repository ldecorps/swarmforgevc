# BL-1239 hardener evidence

**Parcel**: BL-1239-suite-manifest-accounts-for-every-test-file
**Architect commit merged**: bd0e7a2d3a
**Verdict**: PASS

## Merge note

The merge deleted `specs/features/BL-1197-...feature`, flagged by
`check_merge_deletion.sh` against BL-1196 (the combined minting commit
28f30f309 names both BL-1196 and BL-1197). Confirmed deliberate: BL-1197 was
retired as subsumed by BL-1194 upstream (4ff7ad4d1); architect's pre-clear
commit 9b3b3f0d8 removed a stale restored copy of the same file before this
merge, explaining exactly this collision. Named both ticket ids in the merge
commit message per the guard's attribution.

## Scope

- `swarmforge/scripts/test/suite_inventory_lib.bb` — pure inventory check,
  unchanged by this pass (source untouched, confirmed by diff after mutation
  testing).
- `swarmforge/scripts/test/suite_inventory_lib_test_runner.bb` — hardened
  with one new test (below).
- `swarmforge/scripts/test/suite-manifest.tsv` — backfilled by coder, verified
  unchanged in content by this pass.
- Property test `extension/test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js`
  and acceptance steps `specs/pipeline/steps/bl1239SuiteManifestAccountedSteps.js`
  — coder-authored, re-run and confirmed passing, not modified.

## Gates

### Load check
`uptime` load average 2.29 on 20 cores at pass start — quiet, no bypass
needed. No orphaned `node --test`/stryker processes from a prior run.

### Inventory gate (the ticket's own deliverable)
`bb swarmforge/scripts/test/suite_inventory_cli.bb swarmforge/scripts/test`:
`suite inventory: ok - 434 test file(s), 430 standing, 4 excluded with a
dated reason`. Confirms the suite is unblocked, matching the coder's commit
claim. Per the ticket's own `qa_e2e_procedure`, the full `run_bb_suite.sh`
sweep is QA's to run from a detached host shell (the runner's own header
records it killed all 8 live swarm sessions on 2026-08-22) — not run from
this agent pane.

### Unit tests
`bb swarmforge/scripts/test/suite_inventory_lib_test_runner.bb`: PASSED
(after adding the test below).

### Property test (own lane)
`npx vitest run --config vitest.properties.config.mjs
test/bl1239SuiteManifestAccountsForEveryTestFile.property.test.js`: 2/2
PASSED (scoped run, not the full `test:properties` lane, which carries
pre-existing unrelated reds e.g. BL-1063).

### Acceptance
`specs/pipeline/scripts/run_acceptance.sh
specs/features/BL-1239-suite-manifest-accounts-for-every-test-file.feature`:
4/4 PASSED.

### `required_wiring` verification
- `suite-manifest.tsv::test_wsl_bootstrap.sh` — present (`standing` lane,
  line 449). The oldest unregistered file (2026-07-09) was in fact backfilled.
- `specs/pipeline/steps/index.js::bl1239SuiteManifestAccountedSteps` —
  registered (line 865).

### Mutation hardening — Babashka has no wired Stryker/CRAP/DRY
(engineering.prompt, Startup Tools). Hand-authored mutation sweep over
`suite_inventory_lib.bb`'s `check`, `test-file?`, `discover-test-files`, and
`parse-manifest`:

- `test-file?` `or`→`and`: **KILLED**
- dupes threshold `>1`→`>=1`: **KILLED**
- `valid-lanes` membership check inverted: **KILLED**
- date-regex check inverted: **KILLED**
- blank-reason check inverted: **KILLED**
- malformed-row clause (`remove test-file? listed-set`) neutered: **KILLED**
- not-in-tree clause's `test-file?` guard removed (BL-1239's own fix,
  regression-checked): **KILLED**
- `parse-manifest` split `-1` limit removed: **SURVIVED initially — ruled
  EQUIVALENT.** Verified empirically (`bb -e` comparison, both forms on
  four representative rows): dropping `-1` turns trailing empty fields into
  `nil` instead of `""`, but every one of the four destructured fields
  (`file lane date reason`) is immediately normalized with
  `(str/trim (or field ""))`, which maps `nil` and `""` to the identical
  `""`. No row shape can make the two forms diverge in the values `check`
  ever sees. Equivalence is demonstrable from the code per the BL-234
  exception; not pinned as a test (would assert implementation trivia).
- `discover-test-files` drop of `fs/regular-file?` filter: **SURVIVED
  initially — REAL GAP.** A directory whose name matches the `test-file?`
  pattern (e.g. `test_dir_shaped.sh/`) would be discovered as a test file
  and later spawned as one by `run_bb_suite.sh`, with no assertion
  distinguishing that from a real file. Nothing in the real tree names a
  directory this way today, but the guard existed in the code with no test
  proving it. Fixed: added a test creating `test_dir_shaped.sh` as a
  directory and asserting it is excluded from discovery. Confirmed the new
  test goes RED against the mutant (`fs/regular-file?` filter stripped) and
  GREEN with the guard restored (non-vacuity check, both directions run and
  observed).

## Conclusion

BL-1239's backfill and inventory-check hardening from coder is correct and
now more completely tested: one real coverage gap (directory-shaped test
file) closed, one apparent gap (`parse-manifest` split limit) confirmed
equivalent by direct empirical comparison and recorded rather than pinned.
Source file `suite_inventory_lib.bb` is unchanged by this pass — only its
test runner gained one test. Inventory gate, unit tests, property test, and
acceptance suite all green.

**Forwarding to documenter.**
