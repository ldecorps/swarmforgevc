Feature: BL-1562 Every substrate nudge names the helper's real path

  Hotfix 1fc9065605 taught the boot nudge to say ./swarmforge/scripts/
  ready_for_next.sh because seats turned the bare "run ready_for_next.sh"
  into ./ready_for_next.sh at the worktree root and then a find / hunt. The
  tmux wake line typed into a pane on every delivery, the in_process resume
  lines, the freshness-hold line and the already-in-process ACTION line still
  say the bare name. After this ticket every such string is composed from the
  one shared helper-path constant and tells the seat the real path.

  # BL-1562 wake-nudge-helper-path-01
  Scenario Outline: each substrate message that tells a seat to run the helper names its real path
    When the <message> is read through the real library
    Then it tells the seat to run ./swarmforge/scripts/ready_for_next.sh
    And the bare name appears nowhere in its text

    Examples:
      | message                         |
      | tmux wake line                  |
      | in_process resume chat line     |
      | in_process resume shell message |
      | freshness hold line, one ref    |
      | freshness hold line, many refs  |
      | already-in-process ACTION line  |

  # BL-1562 wake-nudge-helper-path-02
  Scenario: the census of run-the-helper strings is complete and every one agrees with the constant
    When the user-facing strings under swarmforge/scripts that tell a seat to run the helper are counted
    Then there are exactly 6 of them
    And every one contains the shared helper-path constant's value
