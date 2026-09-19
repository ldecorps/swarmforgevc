Feature: BL-1650 The land step lands a pure-evidence closed-owner stray itself and never calls a landed ancestor entangled

  The land step refuses to replay a parcel when the two-tree diff carries a
  path whose only owner is a ticket closed on main and no parcel commit
  touches it. On 2026-09-19 that path was a coder's incident evidence file,
  committed on the coder branch after its ticket had moved on and closed,
  inherited by every later branch, and escalated on every later land. After
  this parcel the step cherry-picks such a stray onto main ahead of the
  replay when every path it touches is pure evidence or documentation, says
  so in its log, reports a closed-owner ancestor whose content is already
  on main as landed rather than entangled, and keeps refusing every other
  closed-owner stray exactly as before.

  Background:
    Given a git fixture with a main branch, a role branch, and a ticket BL-4242 closed on main
    And the real land step runs from the fixture root

  # BL-1650 a-pure-evidence-stray-is-landed-ahead-of-the-replay-01
  Scenario: a closed-owner stray touching only an evidence file is cherry-picked onto main and the replay proceeds
    Given the role branch carries a BL-4242 commit that adds only backlog/evidence/BL-4242-incident.md, absent from main
    And a parcel for BL-4343 on top of it
    When the land step runs for BL-4343
    Then main gains that evidence file in a commit carrying the -x trailer naming the stray commit
    And the land log carries one LAND_STRAY_EVIDENCE_LANDED line naming the stray commit, the landed commit and the path
    And the BL-4343 replay proceeds

  # BL-1650 a-stray-touching-code-is-still-an-escalation-02
  Scenario Outline: a closed-owner stray touching any non-evidence path is still refused as before
    Given the role branch carries a BL-4242 commit that adds backlog/evidence/BL-4242-incident.md and <path>, absent from main
    And a parcel for BL-4343 on top of it
    When the land step runs for BL-4343
    Then the land step refuses with LAND_ESCALATE naming BL-4242 and <path>
    And main is unchanged

    Examples:
      | path                                              |
      | swarmforge/scripts/some_lib.bb                    |
      | specs/features/BL-4242-something.feature          |
      | backlog/done/BL-4242-something.yaml               |

  # BL-1650 a-landed-ancestor-is-not-entangled-03
  Scenario: a closed-owner ancestor whose content is already on main is reported landed, not entangled
    Given the role branch carries a BL-4242 commit whose every path is byte-identical on main through BL-4242's own replay
    And a parcel for BL-4343 on top of it
    When the land step runs for BL-4343
    Then the land log carries LAND_SIBLING_LANDED BL-4242
    And no ENTANGLED_SIBLING line names BL-4242
    And the BL-4343 replay proceeds
