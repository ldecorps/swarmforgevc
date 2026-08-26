Feature: lifecycle scripts share one sourced help helper instead of duplicate heredocs

  # BL-736: BL-637 landing commit pasted the same 12-line --help heredoc into 16+
  # launch_*/start_* scripts (plus kill_pipeline_swarm.sh). Factor into one sourced
  # helper parameterized by script name and scope line — same unsynced-list shape
  # BL-671 fixed elsewhere via operator_runtime_sandbox.sh. Pilot gate BL-737 now
  # refuses future lands with this pattern; this ticket removes the existing debt.

  Background:
    Given the BL-637 lifecycle scripts that embed the shared twelve-line help block

  # BL-736 no-duplicate-heredocs-01
  Scenario: no affected script embeds a duplicate --help heredoc body
    When the lifecycle script tree is scanned for embedded help heredocs
    Then no duplicate --help heredoc bodies remain across the affected scripts

  # BL-736 help-output-unchanged-02
  Scenario: each affected script's --help output is unchanged after the refactor
    When each affected script is run with --help after the helper refactor
    Then its output matches the pre-refactor --help output for that script

  # BL-736 lifecycle-tests-pass-03
  Scenario: existing lifecycle teardown shell tests keep passing unchanged in behavior
    When test_lifecycle_script_scope and sibling lifecycle shell tests run
    Then they pass with the same behavior as before the refactor

  # BL-736 shared-helper-sourced-04
  Scenario: affected scripts source one shared print_lifecycle_help helper
    Given the shared lifecycle help helper under swarmforge/scripts
    When each affected script handles -h or --help
    Then it sources and calls the helper with its script name and scope line
    And no script embeds the twelve-line heredoc locally
