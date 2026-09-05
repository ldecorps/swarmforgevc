# mutation-stamp: sha256=bd3f44a01736110771175289626ece60d7166356edfd27d42d125ec42b497327
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T16:08:52.661382180Z","feature_name":"the thirteen property files that import test from node:test are collected by the property lane instead of standing allowlisted","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1206-drain-the-node-test-import-entries-from-the-property-allowlist.feature","background_hash":"852b688cc7bea8ca3f24e4b082a35e160b1c7c63b085aa2c1c243bf2933a591c","implementation_hash":"unknown","scenarios":[{"index":3,"name":"An allowlist entry red for an unrelated reason is left alone","scenario_hash":"15d939048c2cba37df809bbf813d3e10503f1c62baa6787b75aa945d716706af","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-09-05T16:08:52.661382180Z"}]}
# acceptance-mutation-manifest-end

Feature: the thirteen property files that import test from node:test are collected by the property lane instead of standing allowlisted

  # BL-1206 (epic code-quality-gates). BL-1175 unblocked a stuck parcel by
  # allowlisting 27 standing property-lane reds rather than fixing them; every
  # row of swarmforge/scripts/property_suite_standing_allowlist.tsv still reads
  # "pre-existing; tracked under BL-1175 pending fix". BL-1175 has since landed,
  # so the allowlist is permanent and the repair it deferred is untracked.
  #
  # 13 of those 27 share one mechanical cause, measured 2026-08-27: they open
  # with `const { test } = require('node:test')`. vitest.properties.config.mjs
  # sets globals: true and includes test/**/*.property.test.js, so importing
  # node:test's `test` bypasses Vitest's registration entirely. Reproduced on
  # test/alertTelemetry.property.test.js: node:test's own runner executes every
  # case and prints TAP `ok`, while Vitest reports
  # `Error: No test suite found in file ...` and fails the file. The tests pass
  # and the file fails, at the same time.
  #
  # The remaining 229 property files already use the bare `test(...)` the lane's
  # globals supply, which is what makes this a removal rather than a rewrite,
  # and all 13 use plain `test(name, fn)` with no subtests, no `t` argument and
  # no node:test options. The other 14 allowlist rows have unrelated causes and
  # are deliberately untouched here.

  Background:
    Given the property lane runs test/**/*.property.test.js with vitest globals enabled

  # BL-1206 converted-file-is-collected-and-passes-01
  Scenario: A converted property file is collected by the property lane instead of reported as having no suite
    Given a property file that took its test binding from node:test
    When the import is removed so the binding comes from the lane's globals
    And the property lane runs that file
    Then the file is collected
    And its cases are reported by the property lane itself

  # BL-1206 converted-files-leave-the-allowlist-02
  Scenario: A file that now passes is removed from the standing allowlist
    Given a converted property file that passes under the property lane
    When the standing allowlist is read
    Then that file is not listed

  # BL-1206 a-file-still-red-stays-listed-with-its-real-reason-03
  Scenario: A converted file that still fails on its own merits stays allowlisted, with the reason it actually failed
    Given a converted property file that still fails under the property lane
    When the standing allowlist is read
    Then that file is still listed
    And its rationale names the failure it actually has rather than the import

  # BL-1206 unrelated-allowlist-entries-untouched-04
  Scenario Outline: An allowlist entry red for an unrelated reason is left alone
    Given <file> is allowlisted for a cause other than the node:test import
    When the standing allowlist is read
    Then <file> is still listed

    Examples:
      | file                                              |
      | test/hostActivityFeed.property.test.js            |
      | test/selfHealTelemetry.property.test.js           |
      | test/unreachableStepHandlerCheck.property.test.js |

  # BL-1206 no-property-file-binds-test-from-node-test-05
  Scenario: No file in the property lane takes its test binding from node:test
    When every file in the property lane is inspected
    Then none of them imports test from node:test
