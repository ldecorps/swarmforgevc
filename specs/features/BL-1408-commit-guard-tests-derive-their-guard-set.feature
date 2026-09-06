Feature: BL-1408 The commit-guard tests derive their guard set from the chain they exercise

  Four tests still pin the commit-guard chain against a list written by
  hand. test_run_commit_guards.sh stubs five guards for a runner that now
  runs seven, so its first case has exited 127 since 2026-09-04 and the ten
  cases after it never run. test_pre_merge_commit_hook.sh and the BL-1252
  property test match their chains today only because someone edited them by
  hand on the day a guard joined. test_pipeline_code_on_main_guard.sh copies
  the chain into its fixture guard by guard, lacks four the runner now names,
  and has failed case 02 with exit 127 since the same day (found 2026-09-06).
  BL-1398 and BL-1401 fixed two other copies of the same list; this feature
  is that no copy remains: each test reads the runner or hook it exercises
  through BL-1398's helper, so a guard added to a chain is stubbed and run
  without editing any test.

  # BL-1408 the-runner-test-is-green-against-todays-runner-01
  Scenario: the runner test passes every case against the real runner as it stands
    Given the real runner including the handler module graph and bb load guards
    When the runner test runs
    Then the test passes every case

  # BL-1408 the-runner-test-follows-the-runner-02
  Scenario: a guard added to the runner is stubbed and run by the runner test without editing it
    Given a runner seam that names an additional guard present on the seam tree
    When the runner test runs against the seam
    Then the test passes every case
    And it reports the additional guard among the stubs it derived
    And it reports that every derived guard ran

  # BL-1408 the-pre-merge-test-follows-the-hook-03
  Scenario: a guard added to the pre-merge-commit hook is stubbed and run by the pre-merge test without editing it
    Given a pre-merge-commit hook seam that names an additional guard present on the seam tree
    When the pre-merge hook test runs against the seam
    Then the test passes every case
    And it reports the additional guard among the stubs it derived
    And it reports that every derived guard ran

  # BL-1408 the-pipeline-code-guard-test-is-green-against-todays-chains-04
  Scenario: the pipeline-code guard test passes every case against the real chains as they stand
    Given the real runner including the handler module graph and bb load guards
    When the pipeline-code guard test runs
    Then the test passes every case
