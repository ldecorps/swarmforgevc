Feature: BL-1653 A commit abandoned at the subprocess bound never leaves its paths staged, and the reconcile names what blocks it

  Two daemon-side writers stage their paths and then commit through the
  daemon's sixty-second subprocess bound. Under load the pre-commit guard
  chain runs past that bound, the child is killed mid-hook, and the staged
  paths remain. A staged index makes every later merge refuse, so the
  master-main reconcile sweep fails each tick with a bare "conflict" and
  main stops joining origin until a human unstages by hand, which happened
  twice on 2026-09-19. After this parcel an abandoned or refused commit
  leaves the index as it found it, and the sweep names the staged paths
  that block it.

  Background:
    Given a git fixture root under a temporary directory with a main branch and a modified tracked file

  # BL-1653 an-abandoned-commit-restores-the-index-01
  Scenario Outline: a commit that does not land leaves the index as it found it and the worktree change intact
    Given the file is staged by the writer
    When the writer's commit <outcome>
    Then the index matches HEAD afterwards
    And the worktree still carries the modification
    And the writer's result names the restored path

    Examples:
      | outcome                                        |
      | is killed at the subprocess bound              |
      | is refused by a pre-commit guard               |

  # BL-1653 a-landed-commit-is-unchanged-02
  Scenario: a commit that lands behaves exactly as today
    Given the file is staged by the writer
    When the writer's commit lands
    Then HEAD carries the change
    And the writer's result names no restored path

  # BL-1653 the-reconcile-names-the-staged-paths-03
  Scenario: the reconcile sweep names the staged paths that block its merge instead of logging conflict
    Given the file is staged and origin's main is one commit ahead
    When the master-main reconcile sweep runs once
    Then no merge is attempted
    And the log carries an index-not-clean line naming the file
    And the surfaced note names the file

  # BL-1653 a-real-conflict-still-reads-conflict-04
  Scenario: a genuine merge conflict with a clean index still surfaces as conflict
    Given the index matches HEAD and origin's main conflicts with a local commit on the same lines
    When the master-main reconcile sweep runs once
    Then the log carries the conflict line as today
    And no index-not-clean line is logged

  # BL-1653 a-failed-abort-with-no-merge-releases-ownership-05
  Scenario: an abort that finds no merge in progress releases ownership instead of looping
    Given the sweep holds merge ownership for a sha and no merge is in progress
    When the master-main reconcile sweep runs once
    Then the owner record is cleared
    And the log carries no merge-abort-failed line
    And the next run starts from the index check
