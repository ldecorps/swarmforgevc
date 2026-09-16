Feature: BL-1604 A land never carries another ticket's register row removal

  A tip-pure land replays the standing-red register and the property-suite
  allowlist whole from the parcel's tip, so a row another open ticket owns
  that went missing on the branch is deleted from main by an unrelated
  land: BL-1548's land removed BL-1595's row on 2026-09-16 while BL-1595
  was active and its file red, and the cap fell to 1. This feature is that
  the replay restores every such row from origin/main and names it, that
  the landing ticket's own removals and a closed ticket's removals still
  leave, and that an unreadable registry fails closed.

  Background:
    Given a fixture repository under a scratch root with its own origin, a landing ticket and a registry file on origin/main carrying rows owned by the landing ticket, by another open ticket and by a closed ticket

  # BL-1604 a-land-never-carries-another-tickets-register-row-removal-01
  Scenario Outline: the replay restores an open sibling's missing row and lets the landing and closed tickets' removals leave
    Given the landing ticket's tip lacks the <registry> row owned by <owner>
    When the land plan is computed and the replay is built for the landing ticket
    Then the replayed <registry> <outcome>

    Examples:
      | registry                                              | owner                | outcome                                                             |
      | backlog/standing-reds.tsv                             | the other open ticket | carries that row again and the report prints REGISTER_ROW_RESTORED for it |
      | backlog/standing-reds.tsv                             | the landing ticket    | lacks that row and the report prints no REGISTER_ROW_RESTORED         |
      | backlog/standing-reds.tsv                             | the closed ticket     | lacks that row and the report prints no REGISTER_ROW_RESTORED         |
      | swarmforge/scripts/property_suite_standing_allowlist.tsv | the other open ticket | carries that row again and the report prints REGISTER_ROW_RESTORED for it |

  # BL-1604 a-land-never-carries-another-tickets-register-row-removal-02
  Scenario: an unreadable registry on origin/main refuses the land
    Given the registry file on origin/main cannot be read as rows
    When the landing ticket's land is attempted
    Then the attempt is refused with a reason naming the registry file
