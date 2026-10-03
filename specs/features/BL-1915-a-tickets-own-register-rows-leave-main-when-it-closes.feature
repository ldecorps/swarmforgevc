Feature: BL-1915 A landed ticket's own register rows leave main in the commit that closes it, so owning a row no longer keeps a line off the merge path

  BL-1631 has the land step retire every register row the landing ticket
  owns. BL-1901's merge path cannot do that, so it declines every line
  whose ticket owns a row (QA spec-gap 003735), and each such land is
  rebuilt by the land step instead. BL-1907 went that way on 2026-10-03
  for its three standing-red rows. BL-1870 names this move as the first
  thing to do before the land step's rebuild machinery can be deleted.
  The close is where a ticket stops being open, which is the moment its
  rows would otherwise become unowned. So close_ticket.sh removes them, in
  the same commit that moves the ticket to backlog/done/, and the merge
  path no longer declines for them.

  Background:
    Given a fixture project with a bare origin, a lander queue and an active ticket BL-9001

  # BL-1915 a-row-owner-lands-by-merge-01
  Scenario: a line whose ticket owns a register row lands on the merge path
    Given origin/main's backlog/standing-reds.tsv carries a row owned by BL-9001
    And the lander queue holds an entry for BL-9001 whose line carries only BL-9001 commits
    When the lander sweep runs until the queue is empty
    Then the land record for BL-9001 names the merge path
    And origin/main's backlog/standing-reds.tsv still has the row owned by BL-9001

  # BL-1915 the-close-commit-retires-own-rows-02
  Scenario Outline: closing a ticket removes its own rows from a register in the close commit
    Given <register> carries a row owned by BL-9001 and a row owned by BL-9002, an open ticket
    When close_ticket.sh closes BL-9001
    Then the commit that moves BL-9001 to backlog/done/ also removes BL-9001's row from <register>
    And <register> still has the row owned by BL-9002

    Examples:
      | register                                                  |
      | backlog/standing-reds.tsv                                 |
      | backlog/suite-poles.tsv                                   |
      | swarmforge/scripts/property_suite_standing_allowlist.tsv  |

  # BL-1915 an-accepted-pole-survives-its-owners-close-03
  Scenario: an accepted pole row survives its owner's close
    Given backlog/suite-poles.tsv carries an accepted pole row owned by BL-9001
    When close_ticket.sh closes BL-9001
    Then backlog/suite-poles.tsv still has the accepted pole row owned by BL-9001
