Feature: Co-change coupling report analyzes whole-repo history regardless of invoker cwd

  Background:
    Given a git repository whose history has commits that changed files across more than one top-level directory

  # BL-268 co-change-cwd-independence-01
  Scenario: cross-directory co-changers are reported when the tool runs from a subdirectory
    Given a file that has historically co-changed with files in other top-level directories
    When the co-change report for it runs from a repository subdirectory
    Then the report lists the cross-directory co-changers with their co-change counts
    And the report is identical to running it from the repository root

  # BL-268 co-change-cwd-independence-02
  Scenario: a changed-file argument written relative to the current directory is accepted
    Given a tracked file addressed by a path relative to a repository subdirectory
    When the co-change report for it runs from a repository subdirectory
    Then the argument resolves to its repo-relative history path and its co-changers are reported
