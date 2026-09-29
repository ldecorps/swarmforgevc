Feature: BL-1815 A Claude seat writes a knowledge brief before a local model takes its role
  If the model steward moves a role's seat from a Claude agent to a
  local-model agent, at either end of a trial, the outgoing Claude seat is
  still live and knows what is in flight, what already failed and what not
  to redo. Before the seat moves, it writes that down as a short brief.
  The brief becomes the portable payload's continuity summary (BL-1177,
  schema 1) and is kept on disk for the incoming seat. A move that owes a
  brief and does not get a usable one is refused: the seat stays where it
  was. Every other agent pair crosses a trial boundary exactly as before.

  Background:
    Given a fixture repository whose model steward is about to move the "coder" seat

  # BL-1815 only-claude-to-local-model-owes-a-brief-01
  Scenario Outline: a knowledge brief is owed only for a move from claude to local-model
    Given the outgoing seat runs the "<outgoing>" agent and the incoming seat the "<incoming>" agent
    When the trial boundary moves the seat
    Then a knowledge brief <request>

    Examples:
      | outgoing    | incoming    | request                             |
      | claude      | local-model | is requested from the outgoing seat |
      | claude      | claude      | is not requested                    |
      | local-model | claude      | is not requested                    |
      | claude      | aider       | is not requested                    |

  # BL-1815 a-written-brief-is-the-payload-02
  Scenario: a brief written within the wait becomes the persisted continuity summary and the seat moves
    Given the outgoing seat runs the "claude" agent and the incoming seat the "local-model" agent
    And the outgoing seat writes a 1200-character brief within the wait
    When the trial boundary moves the seat
    Then the persisted payload for "coder" has schema version 1 and that brief as its continuity summary
    And the "coder" seat now runs the "local-model" agent

  # BL-1815 an-unusable-owed-brief-refuses-the-move-03
  Scenario Outline: an owed brief that is <problem> refuses the move
    Given the outgoing seat runs the "claude" agent and the incoming seat the "local-model" agent
    And the outgoing seat's brief is <problem>
    When the trial boundary moves the seat
    Then the move is refused with a reason naming "<reason>"
    And the "coder" seat now runs the "claude" agent

    Examples:
      | problem                       | reason      |
      | never written within the wait | no brief    |
      | empty                         | empty brief |
      | 2001 characters long          | over 2000   |
