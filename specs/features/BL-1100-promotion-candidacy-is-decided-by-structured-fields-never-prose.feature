Feature: Promotion candidacy is decided by structured fields, never by prose

  The promotion scan disqualifies a candidate by grepping the whole ticket
  YAML for a hold phrase. Any sentence that merely DISCUSSES promotion
  ordering - an orthogonality caution, a dependency wait, or a numbered spec
  step describing what an approvals surface must not do - reads identically
  to a human parking the ticket. On the auto-pick path the candidate is then
  dropped without a word.

  A structured hold already exists and already works: `status: blocked` on
  its own anchored line, and `backlog/hold/` for a human park. Prose is the
  one mechanism that cannot tell a directive from a description of one.

  This file quotes the trigger phrase verbatim on purpose. Only ticket YAML
  is scanned by the guard, never a feature file - which is why the ticket
  itself cannot quote it and this file can. See BL-1100 notes.

  Background:
    Given a paused ticket that is otherwise eligible for promotion

  # BL-1100 prose-never-blocks-promotion-01
  Scenario Outline: Prose that discusses promotion ordering never disqualifies a ticket
    Given the ticket's prose contains <sentence>
    When the coordinator scans for a promotion candidate
    Then the ticket is among the candidates

    Examples:
      | sentence                                                          |
      | "Do not promote them concurrently; the second should merge main"  |
      | "do not promote this one until BL-1022 has reached done/"         |
      | "4. Do not flip human_approval. Do not promote. Do not dispatch." |

  # BL-1100 prose-never-blocks-promotion-02
  Scenario: A structured hold still refuses the ticket, and says which gate refused it
    Given the ticket declares status blocked
    When the coordinator scans for a promotion candidate
    Then the ticket is not among the candidates
    And the scan reports that ticket's id and the gate that refused it

  # BL-1100 prose-never-blocks-promotion-03
  Scenario: A ticket named explicitly is promoted despite its ordering prose
    Given the ticket's prose contains "Do not promote them concurrently"
    When the coordinator is asked to promote that ticket by id
    Then the ticket is promoted

  # BL-1100 prose-never-blocks-promotion-04
  Scenario Outline: A ticket a human parked in prose is still refused after the change
    Given the parked ticket <ticket>, whose only bar to promotion is a human directive in its prose
    When the coordinator scans for a promotion candidate
    Then the ticket is not among the candidates
    And that human directive is still present in the ticket verbatim

    Examples:
      | ticket |
      | BL-553 |
      | BL-556 |
      | BL-828 |
