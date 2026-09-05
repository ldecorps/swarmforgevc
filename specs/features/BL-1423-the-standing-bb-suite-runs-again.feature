# mutation-stamp: sha256=f0f791fcf00bbc95e4b27cced3edb16d77018c6d0c8d0bd7c62cc4c107544658
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-05T10:58:14.861604500Z","feature_name":"BL-1423 The standing Babashka suite runs again: the two hotfix test files are registered","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1423-the-standing-bb-suite-runs-again.feature","background_hash":"7c3e36221944e7bd08900b53b0e9ee57f9ac4a9ec99d4e414c6ca66b7bb49c3b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"each hotfix test file has exactly one standing row and is listed by the standing run","scenario_hash":"c3b833c88c006ab006a0b5df7270eceeafcc3b55c9a26c5840e610ad4395d90d","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-05T10:58:14.861604500Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1423 The standing Babashka suite runs again: the two hotfix test files are registered

  run_bb_suite.sh runs the suite inventory gate first and unconditionally,
  and refuses the whole run when any test file under swarmforge/scripts/test/
  has no row in suite-manifest.tsv. Hotfix 27d6ab8630 (2026-09-02) added
  handoffd_supervisor_startup_grace_test_runner.bb and
  test_handoffd_outbox_vanished_parcel_wiring.sh with no row. BL-1240's
  registration gate is parcel-scoped and fires at a git_handoff, so a hotfix
  committed straight onto main never met it, and BL-1342's stamp-off
  certified the hotfix's behaviour, not the suite's membership. The standing
  suite has refused every run since.

  This feature is that both files carry a standing row, the inventory gate
  passes on the parcel's tree, and the standing run lists both files as
  members. Every scenario reads the parcel's own tracked tree and manifest
  and runs no test: a read-only live-tree read, justified because the tree
  at this commit is the contract.

  Background:
    Given the parcel's own swarmforge/scripts/test tree and its suite-manifest.tsv

  # BL-1423 the-inventory-gate-passes-01
  Scenario: the suite inventory gate passes on the parcel's tree
    When suite_inventory_cli.bb is run against that tree
    Then it exits 0 reporting no problems

  # BL-1423 each-hotfix-test-is-a-standing-member-02
  Scenario Outline: each hotfix test file has exactly one standing row and is listed by the standing run
    When the manifest rows naming <file> are collected
    Then there is exactly one such row
    And its lane is standing with an empty date and an empty reason
    And run_bb_suite.sh --list names <file>

    Examples:
      | file                                             |
      | handoffd_supervisor_startup_grace_test_runner.bb |
      | test_handoffd_outbox_vanished_parcel_wiring.sh   |
