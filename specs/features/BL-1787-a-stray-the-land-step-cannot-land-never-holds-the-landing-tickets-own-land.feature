Feature: BL-1787 A stray the land step cannot land never holds the landing ticket's own land

  The land step cherry-picks a closed owner's pure-evidence stray commit
  onto the replay branch ahead of the landing ticket's own tip-pure commit
  (BL-1650). When the cherry-pick conflicts and neither superseded ground
  holds (BL-1670, BL-1768), the step used to abort the whole replay, so a
  stray on paths the landing ticket never touched turned every land into
  a LAND_ESCALATE and a condition (g) hand build. That happened to four lands
  on 2026-09-20 and five on 2026-09-26. Such a stray is now deferred. The step leaves
  it unlanded, never reports it superseded, prints one
  LAND_STRAY_DEFERRED line naming it, and goes on to build the landing
  ticket's own commit. A stray the step cannot land on a path the landing
  ticket itself changed still escalates by name, as before. Every
  scenario runs against a fixture repository under mkdtemp with its own
  origin (BL-1390).

  Background:
    Given a fixture repository with an origin and a main branch

  # BL-1787 an-unproven-stray-off-the-tickets-paths-is-deferred-01
  Scenario Outline: an unproven pure-evidence stray on no path of the landing ticket's is deferred and the land completes
    Given a closed owner's pure-evidence stray whose path <shape> on origin/main
    And the landing ticket's own commit changes only a path no stray touches
    When the land step runs for the landing ticket at the tip
    Then it exits 0 with LAND_REPLAY and one LAND_STRAY_DEFERRED line naming the stray's commit and its path
    And no LAND_STRAY_SUPERSEDED line is printed and the stray's owner is never reported LANDED_SIBLING
    And the replay tip carries the landing ticket's own path and origin/main's content at the stray's path

    Examples:
      | shape                                                                                      |
      | was rewritten by another ticket after its owner's land beside a stray line that is missing |
      | conflicts with a line another ticket wrote before its owner's land                         |

  # BL-1787 an-unproven-stray-on-the-tickets-own-path-still-escalates-02
  Scenario: an unproven pure-evidence stray on a path the landing ticket also changed still escalates by name
    Given a closed owner's pure-evidence stray whose path conflicts with a line another ticket wrote before its owner's land on origin/main
    And the landing ticket's own commit also changes the stray's path
    When the land step runs for the landing ticket at the tip
    Then it exits LAND_ESCALATE naming the stray's commit
    And no LAND_STRAY_DEFERRED line is printed

  # BL-1787 a-deferred-stray-never-stops-a-later-stray-landing-03
  Scenario: a deferred stray does not stop a later landable stray from landing
    Given a closed owner's pure-evidence stray whose path conflicts with a line another ticket wrote before its owner's land on origin/main
    And after it a second closed owner's pure-evidence stray on another path that applies cleanly
    And the landing ticket's own commit changes only a path no stray touches
    When the land step runs for the landing ticket at the tip
    Then it prints LAND_STRAY_DEFERRED for the first stray and LAND_STRAY_EVIDENCE_LANDED for the second
    And the replay tip carries the second stray's content and the landing ticket's own path
