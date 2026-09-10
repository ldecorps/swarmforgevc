Feature: BL-1501 The two hotfix test runners sweep the temp roots they create

  Two Babashka test runners landed by the 2026-09-09 hotfixes, d9a4d0b888
  (landed_ticket_autoclose_test_runner.bb) and 6e05b02dd3
  (wake_dedup_lib_test_runner.bb), build their fixtures with
  fs/create-temp-dir and never remove them: measured on main 60623ebf02,
  one run leaves four and one directories behind respectively. The
  standing unit-lane guard extension/test/tempDirTrapGuard.test.js scans
  the real swarmforge/scripts tree for exactly that shape and has been red
  since the first hotfix landed. This feature is that both runners adopt
  the cleanup mechanism every sibling runner already carries, so the guard
  earns its green from the files themselves and no fixture root outlives
  the process that made it.

  # BL-1501 hotfix-runners-sweep-their-temp-roots-01
  Scenario: the real swarmforge/scripts tree has zero temp-dir-trap violations
    When the temp-dir-trap guard scans the real swarmforge/scripts tree
    Then it reports zero violations
    And the scanned tree still holds landed_ticket_autoclose_test_runner.bb and wake_dedup_lib_test_runner.bb, each creating a temp root

  # BL-1501 hotfix-runners-sweep-their-temp-roots-02
  Scenario Outline: a hotfix runner leaves no temp root behind on a normal exit
    Given an empty directory designated as the Babashka temp root
    When <runner> runs to completion with its temp root pointed at that directory
    Then the runner exits 0
    And the designated directory is empty afterwards

    Examples:
      | runner                                 |
      | landed_ticket_autoclose_test_runner.bb |
      | wake_dedup_lib_test_runner.bb          |

  # BL-1501 hotfix-runners-sweep-their-temp-roots-03
  Scenario: the guard is not blunted to earn the green
    When the temp-dir-trap guard's file-level exempt list is read
    Then it names only tmp_cleanup.sh
    And a scratch tree holding one Babashka file that creates a temp root with no cleanup is still reported
