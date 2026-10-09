Feature: BL-2087 the sampled reach floor gate checks a coder's first send

  BL-1584's gate refuses a git_handoff whose parcel adds a property test
  with a sampled reach floor. It decides "added" against the commit the
  sender received. A coder takes up a new ticket from a Work note, which
  carries no commit, so on the coder's first send the gate has nothing to
  compare against and sends silently. The first send is where a parcel
  adds its property tests, so the gate never fired for them: at least
  thirteen sampled-low files landed after it shipped, and two of them went red in
  QA on 2026-10-08. This feature checks the first send against the
  parcel's base on main.

  Background:
    Given a fixture repository whose main branch carries the frozen classifier corpus under specs/pipeline/fixtures/bl1584
    And a coder whose in_process mailbox holds only the Work note for its ticket, with no commit

  # BL-2087 the-sampled-reach-floor-gate-checks-a-coders-first-send-01
  Scenario Outline: a coder's first send that adds a property test is decided by how the test draws
    Given the parcel's own commit adds a property test file shaped like the corpus file <corpus file>
    When the coder sends its first git_handoff for the ticket
    Then the send is <outcome>

    Examples:
      | corpus file                            | outcome |
      | bl1327DescentLadderInvariants          | refused |
      | cursorSeatDriver                       | refused |
      | bl1281ReachFloorConstructionInvariants | allowed |

  # BL-2087 the-sampled-reach-floor-gate-checks-a-coders-first-send-02
  Scenario: a coder's first send that modifies a property test already on main warns and sends
    Given main already carries a property test file shaped like the corpus file bl1327DescentLadderInvariants
    And the parcel's own commit modifies that file without constructing its floor
    When the coder sends its first git_handoff for the ticket
    Then the send is allowed
    And a sampled reach floor warning names that property test file
