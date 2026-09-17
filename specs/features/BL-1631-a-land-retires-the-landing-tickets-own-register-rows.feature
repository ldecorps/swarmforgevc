Feature: BL-1631 A land retires the landing ticket's own register rows

  A standing-red row is meant to leave in the land that turns its test
  green, and nothing makes that happen: three lands on 2026-09-17 closed
  with their own rows present, each read as unowned within minutes,
  throttled intake to one and was retired by hand. BL-1604 taught the
  land step to restore other open tickets' rows a replay would drop; this
  feature is its mirror - every row in the standing-red register, the
  property allowlist and the pole register whose owner is the landing
  ticket is retired when the replay commit is built, printed one line per
  row, while an accepted pole row and every other ticket's row are left
  exactly as BL-1604 leaves them.

  # BL-1631 land-retires-the-landing-tickets-own-rows-01
  Scenario Outline: only rows owned by the landing ticket are retired, an accepted pole row never
    Given a <registry> holding a row owned by the landing ticket, a row owned by another open ticket, and <extra>
    When the rows to retire for the landing ticket are computed
    Then exactly the landing ticket's row is retired

    Examples:
      | registry                                              | extra                                   |
      | standing-red register                                 | a comment line                          |
      | property suite standing allowlist                     | a comment line                          |
      | pole register                                         | an accepted row naming the landing ticket as its rationale |

  # BL-1631 land-retires-the-landing-tickets-own-rows-02
  Scenario: the real land step drops the landing ticket's row from the replay and prints it
    Given a fixture repository whose origin/main and tip both carry the landing ticket's standing-red row
    When the land step builds the replay commit for the landing ticket
    Then the replay commit's standing-red register carries no row owned by the landing ticket
    And the land step prints one REGISTER_ROW_RETIRED line naming the register, the file and the owner

  # BL-1631 land-retires-the-landing-tickets-own-rows-03
  Scenario: another open ticket's row the tip lacks is still restored, as BL-1604 requires
    Given a fixture repository whose origin/main carries a row owned by another open ticket that the tip removed
    When the land step builds the replay commit for the landing ticket
    Then the replay commit's standing-red register still carries that other ticket's row
    And the land step prints one REGISTER_ROW_RESTORED line for it
