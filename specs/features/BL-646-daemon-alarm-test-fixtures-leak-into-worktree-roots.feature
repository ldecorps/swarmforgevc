Feature: daemon-death/alarm test suites never leave debris in a worktree root

  # BL-646: daemon-death/alarm suites write calls.log, email-text.txt,
  # failure.log, status.json relative to CWD instead of a temp dir, leaking
  # into whichever worktree root the suite ran in. No role may delete them
  # (workflow.prompt's "never delete what you did not create"), so they
  # persist, block clean fast-forwards, and get re-surfaced by every role
  # that stumbles onto them. Fix is at the source (temp dirs + a
  # clean-working-tree assertion) plus removing the eight files already
  # leaked into .worktrees/QA and .worktrees/coder.

  # BL-646 suites-leave-no-untracked-files-01
  Scenario: running the daemon-death/alarm suites leaves the working tree clean
    Given a worktree root with a clean git status before the run
    When the daemon-death/alarm test suites run to completion
    Then "git status --porcelain" for that root reports no untracked files

  # BL-646 seeded-leak-fails-the-guard-02
  Scenario: a deliberately seeded leak fails the clean-working-tree guard
    Given a test in the daemon-death/alarm suite is seeded to write a file relative to CWD instead of a temp dir
    When the suite runs
    Then the run fails
    And the failure names the leaked file

  # BL-646 existing-leaked-files-removed-03
  Scenario Outline: the eight previously leaked fixture files are gone
    Given the fixture file "<file>" previously leaked into "<worktree root>"
    When this ticket's fix lands
    Then "<file>" is absent from "<worktree root>"

    Examples:
      | worktree root      | file            |
      | .worktrees/QA      | calls.log       |
      | .worktrees/QA      | email-text.txt  |
      | .worktrees/QA      | failure.log     |
      | .worktrees/QA      | status.json     |
      | .worktrees/coder   | calls.log       |
      | .worktrees/coder   | email-text.txt  |
      | .worktrees/coder   | failure.log     |
      | .worktrees/coder   | status.json     |

  # BL-646 gitignore-does-not-mask-a-real-future-file-04
  Scenario: a gitignored fixture name does not mask a real future file of the same name
    Given the fixture names are added to .gitignore as a belt-and-suspenders measure
    And a directory exists where a file of that name would be genuine, load-bearing state
    When that directory is inspected
    Then the genuine file is not silently hidden from git status

  # BL-646 babysitter-hint-flips-for-pure-tool-droppings-05
  Scenario: a worktree holding only known fixture droppings is not advised to commit them
    Given a worktree root's HEAD has not moved
    And its only untracked files are the four known fixture names
    When the babysitter check assesses that worktree
    Then it does not advise committing the untracked files
