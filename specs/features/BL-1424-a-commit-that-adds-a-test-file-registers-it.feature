Feature: BL-1424 A commit that adds a test file registers it, or is refused

  BL-1240 refuses a git_handoff whose parcel adds a file under
  swarmforge/scripts/test/ with no suite-manifest.tsv row, so the author is
  told rather than QA. It fires at the send, so a commit that never becomes
  a parcel never meets it: hotfix 27d6ab8630 was committed straight onto
  main on 2026-09-02 with two unregistered test files, and run_bb_suite.sh
  refused every run for three days before a coordinator sweep noticed
  (BL-1423). The pre-commit guard chain (BL-1252) runs on every commit in
  every checkout, human or agent, and is where the same question belongs.

  This feature is a cheap-tier guard in that chain which refuses a commit
  that itself ADDS a test file with no row in the staged manifest, quoting
  the row it needs, and which is otherwise silent: drift the commit did not
  create never refuses it (BL-1240's parcel-scoped property, carried to the
  commit), a helper under lib/ is not a test file, and a manifest the guard
  cannot read warns and allows. Every scenario runs the guard inside a
  fixture repository initialised under a temporary directory, never the
  live checkout. The verdict step is one step with three known values, so
  one handler judges every outcome.

  Background:
    Given a fixture repository whose swarmforge/scripts/test tree is fully registered in its suite-manifest.tsv

  # BL-1424 a-staged-addition-is-judged-by-shape-and-row-01
  Scenario Outline: a staged addition is refused only when it is a test file with no row
    Given the commit stages a new file <path> with <row>
    When check_test_file_registration.sh runs in that repository
    Then the guard <verdict>

    Examples:
      | path                                         | row                     | verdict                                                           |
      | swarmforge/scripts/test/test_bl9001_probe.sh | no manifest row         | refuses, naming test_bl9001_probe.sh and quoting its standing row |
      | swarmforge/scripts/test/test_bl9001_probe.sh | a standing manifest row | exits 0 with no refusal                                           |
      | swarmforge/scripts/test/lib/test_helper.sh   | no manifest row         | exits 0 with no refusal                                           |
      | swarmforge/scripts/test/fixture_notes.md     | no manifest row         | exits 0 with no refusal                                           |
      | swarmforge/scripts/probe_test_runner.bb      | no manifest row         | exits 0 with no refusal                                           |

  # BL-1424 pre-existing-drift-never-refuses-02
  Scenario: drift the commit did not create never refuses it
    Given the fixture history already holds test_bl9000_stale.sh under swarmforge/scripts/test/ with no manifest row
    And the commit stages a change that adds no test file
    When check_test_file_registration.sh runs in that repository
    Then the guard exits 0 with no refusal

  # BL-1424 an-unreadable-manifest-warns-and-allows-03
  Scenario: a manifest the guard cannot read warns and allows
    Given the staged deletion of suite-manifest.tsv accompanies a new test file test_bl9001_probe.sh
    When check_test_file_registration.sh runs in that repository
    Then the guard warns that the manifest could not be read and exits 0 with no refusal
