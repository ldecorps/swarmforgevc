Feature: BL-1484 The hook-installing fixtures derive their guard set from the hooks they install

  Four shell tests install the real pre-commit and commit-msg hooks into a
  disposable repository and drive a real git commit through them, building
  the scripts the hooks reach from a list of cp lines written by hand. Two
  of them have been red since 2026-08-30, when pre-commit became a wrapper
  that execs run_commit_guards.sh and neither list gained it; the other two
  match commit-msg only because someone edits them the day a guard joins.
  BL-1398, BL-1401 and BL-1408 fixed six other copies of the same list
  through one helper; this feature is that these four read it too, with
  commit-msg as a chain source the helper understands, so a guard added to
  either hook is copied and run without editing any test.

  # BL-1484 hook-fixture-is-green-against-todays-hooks-01
  Scenario Outline: a hook-installing fixture passes every case against the real hooks and runner as they stand
    Given the real pre-commit and commit-msg hooks and the runner they exec, as they stand on the tree
    When the hook fixture <fixture> runs against the live repository
    Then the fixture passes every case
    And it reports the copy set it derived

    Examples:
      | fixture                             |
      | test_ticket_deletion_guard.sh       |
      | test_commit_size_guard.sh           |
      | test_merge_deletion_guard.sh        |
      | test_retirement_readdition_guard.sh |

  # BL-1484 hook-fixture-follows-the-runner-02
  Scenario: a guard added to the runner is copied into the fixture and run without editing the test
    Given a seam tree whose runner names an additional guard present beside it
    When the ticket-deletion hook fixture runs against the seam
    Then the fixture passes every case
    And it reports the additional guard among the files it derived

  # BL-1484 hook-fixture-follows-commit-msg-03
  Scenario: a guard added to the commit-msg hook is copied into the fixture and run without editing the test
    Given a seam tree whose commit-msg hook calls an additional guard present beside it
    When the ticket-deletion hook fixture runs against the seam
    Then the fixture passes every case
    And it reports the additional guard among the files it derived

  # BL-1484 a-named-guard-the-tree-lacks-fails-loud-04
  Scenario: a guard the commit-msg hook names but the seam tree lacks fails the fixture naming the guard
    Given a seam tree whose commit-msg hook calls a guard that is absent beside it
    When the ticket-deletion hook fixture runs against the seam
    Then the fixture fails naming the absent guard
    And no case is reported as passed after the failure
