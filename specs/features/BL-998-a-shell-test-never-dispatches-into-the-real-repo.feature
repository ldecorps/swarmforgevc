Feature: A shell test never dispatches into the real repo

  The receive and completion helpers resolve their own root. The .sh wrappers
  do cd into their own directory, and the .bb dispatcher hands off to those
  wrappers by name, so a test that runs the dispatcher from the real scripts
  directory gets the REAL repo root - whatever fixture it had cd'd into.

  Two things follow, and the second is worse than the first. The test proves
  nothing about its fixture, so a standing regression guard silently protects
  nothing. And the helper does what it always does: it claims. A suite run
  can dequeue a live parcel out of a real role's mailbox.

  Background:
    Given a fixture worktree and a real repo whose mailbox holds a parcel

  # BL-998 dispatch-stays-in-the-fixture-01
  Scenario: A test dispatching a receive helper reads only its own fixture
    When the test dispatches the receive helper from its fixture
    Then the parcel claimed is the fixture's own
    And the real repo's mailbox is unchanged

  # BL-998 completion-stays-in-the-fixture-02
  Scenario: A test completing a parcel writes only into its own fixture
    When the test dispatches the completion helper from its fixture
    Then the real repo's mailbox is unchanged

  # BL-998 guard-names-a-new-offender-03
  Scenario: The isolation guard fails on a test that dispatches without installing scripts
    Given a shell test that executes a receive dispatcher without installing scripts into its fixture
    When the isolation guard runs
    Then the guard fails
    And the failure names that test

  # BL-998 guard-spares-the-safe-shapes-04
  Scenario Outline: The guard leaves a correctly isolated test alone
    Given a shell test that <shape>
    When the isolation guard runs
    Then the guard passes

    Examples:
      | shape                                                  |
      | installs the scripts tree into its fixture             |
      | calls a leaf helper directly with an explicit root      |
