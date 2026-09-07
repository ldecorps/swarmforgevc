Feature: BL-1463 An escalating land step still names the sibling it could not read

  BL-1272 promised that a sibling is reported as entangled on positive
  evidence it is unlanded, and its fourth example is the sibling whose
  attribution cannot be read. BL-1343 then made an unreadable attribution
  refuse rather than narrow: land-plan's nil-paths branch escalates, and
  that branch returns a reason and nothing else - the entangled, landed
  and unlanded sets computed a few lines above never reach the map. The
  CLI's escalate outcome prints LAND_ESCALATE and the reason, no
  ENTANGLED_SIBLING line, no entanglement note, so the sibling BL-1272
  says must be named is not. Example row 4 has been red since BL-1343
  landed on 2026-09-02, found by the coder on 2026-09-07 running
  BL-1447's e2e. Naming is evidence about the sibling; which action
  follows is a separate decision, and the name must survive either.

  Background:
    Given a fixture repository with an origin, a main branch, and a parcel tip whose ancestry carries a sibling ticket's commit

  # BL-1463 an-unreadable-attribution-escalates-naming-the-sibling-01
  Scenario: an unreadable sibling attribution escalates naming the sibling as entangled
    Given the sibling's attributed content is unreadable on origin/main
    When the land step CLI plans the parcel's tip
    Then it prints LAND_ESCALATE
    And it prints an ENTANGLED_SIBLING line naming the sibling
    And its entanglement note names the sibling as unlanded

  # BL-1463 an-escalation-with-no-sibling-in-evidence-names-none-02
  Scenario Outline: an escalation with no sibling in evidence names none
    Given the land step escalates because <reason>
    When the land step CLI plans the parcel's tip
    Then it prints LAND_ESCALATE and no ENTANGLED_SIBLING line

    Examples:
      | reason                           |
      | the task name names no ticket id |
      | origin/main cannot be resolved   |

  # BL-1463 an-unreadable-attribution-still-refuses-rather-than-narrowing-03
  Scenario: an unreadable attribution still refuses rather than narrowing
    Given the sibling's attributed content is unreadable on origin/main
    When the land step plans the parcel's tip
    Then the plan's action is escalate, never replay

  # BL-1463 the-register-row-leaves-with-the-fix-04
  Scenario: the register row leaves with the fix
    When the fix is on main
    Then backlog/standing-reds.tsv carries no row for BL-1272's feature file
