Feature: BL-1686 A fixture proves its root before git init, and no shell test sweeps a live sibling's tmproot
  A shell test fixture proves its root under its own tmproot before the
  first mutating git command, so a root that vanished cannot send git
  init into the process's working directory; and a test's startup sweep
  reaps only temp roots whose owner process is dead, so two concurrent
  runs of the same file never delete each other's live roots.

  # BL-1686 the-proof-fires-before-any-git-command-01
  Scenario: a fixture whose tmproot vanished refuses before any git command runs
    Given a scratch working directory that is not a repository
    And the bl1378 test's tmproot created and then removed before its fixture builder runs
    When the fixture builder runs from that working directory
    Then it refuses with the root proof's own message
    And no git command ran and the working directory holds no repository

  # BL-1686 a-live-siblings-root-survives-the-startup-sweep-02
  # Census pin (BL-1445): the five files are named, not derived.
  Scenario Outline: the startup sweep reaps only roots whose owner is dead
    Given two temp roots under <file>'s prefix, one recording a live owner pid and one a dead pid
    When <file>'s startup sweep runs
    Then the live owner's root survives
    And the dead owner's root is removed

    Examples:
      | file                                    |
      | bl1363_close_ticket_property_runner.sh  |
      | test_bl1376_expedite_branch_handover.sh |
      | test_bl1378_expedite_close_guard.sh     |
      | test_suite_baseline_cli.sh              |
      | test_bl1374_sync_merge_passengers.sh    |

  # BL-1686 the-blind-idiom-is-gone-03
  Scenario: no shell test carries the blind prefix sweep
    When the shell tests under swarmforge/scripts/test are grepped for the blind prefix sweep idiom
    Then it names no file
