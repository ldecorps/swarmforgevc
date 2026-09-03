Feature: An answer given in a session reaches the ticket

  A ticket that poses a choice declares `ruling_options`, and a tap on the ask
  records a `human_ruling:` block. The human does not always answer there. They
  answer in whatever agent session they happen to be talking to, and that
  channel writes to no swarm store at all.

  From the swarm's side an in-session answer is indistinguishable from no
  answer: the ruling field is empty, the approval is untouched, the stored ask
  is stale, and no decision record exists. So an honest report of a real answer
  and an unverifiable claim look exactly alike — which is how BL-1296 cost four
  agent turns for one question the operator had already answered.

  Recording it must not become a way to manufacture consent. The relay records
  what was said and who relayed it; it never records approval, which stays the
  human's own tap.

  Background:
    Given a ticket that declares ruling options

  # BL-1369 an-answer-given-in-a-session-reaches-the-ticket-01
  Scenario: a relayed answer becomes visible on the ticket
    Given the human answered one of the options in an agent session
    When the answer is relayed to the ticket
    Then the ticket records that option as the human ruling
    And the ruling records that it was relayed and by whom

  # BL-1369 an-answer-given-in-a-session-reaches-the-ticket-02
  Scenario: relaying an answer never records approval
    Given the human answered one of the options in an agent session
    And the ticket is pending approval
    When the answer is relayed to the ticket
    Then the ticket is still pending approval

  # BL-1369 an-answer-given-in-a-session-reaches-the-ticket-03
  Scenario: a relayed answer never overwrites one the human tapped
    Given the ticket already records a human ruling from a tap
    And the human answered one of the options in an agent session
    When the answer is relayed to the ticket
    Then the relay is refused
    And the recorded human ruling is unchanged

  # BL-1369 an-answer-given-in-a-session-reaches-the-ticket-04
  Scenario: an answer that matches no declared option is refused
    Given the human answered with something matching no declared option
    When the answer is relayed to the ticket
    Then the relay is refused naming the declared options
    And the ticket records no human ruling

  # BL-1369 an-answer-given-in-a-session-reaches-the-ticket-05
  Scenario: a tapped ruling still supersedes a relayed one
    Given the ticket records a relayed human ruling
    When the human taps a different option on the ask
    Then the ticket records the tapped option as the human ruling
