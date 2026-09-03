Feature: Closing a ticket is one command

  The coordinator's promotion half is a script: `promote_and_route_next.sh`
  moves the ticket, rewrites `assigned_to`, commits through the integrity CLI
  and obeys a refusal rather than falling back to a raw commit. Its mirror -
  closing an approved ticket - is not scripted at all, and the coordinator
  performs it by hand after every approval.

  Measured over 45 days: 484 promotion commits carry the script's own generated
  subject, while 409 close commits are hand-made. The hand-made half has drifted:
  `backlog/done/` holds 665 loose ticket files beside milestone directories
  holding 516 more, because nothing decides which one a close writes to.

  A close must also honour Article 2.6 - when one approved commit satisfies
  several tickets, every id moves or the close refuses, because an id that never
  reaches done/ stays active forever.

  Background:
    Given QA has approved a ticket and the coordinator is doing bookkeeping

  # BL-1363 closing-a-ticket-is-one-command-01
  Scenario: an approved ticket is moved and committed in one step
    When the coordinator closes the ticket
    Then the ticket file is in the done area for its milestone
    And the move is committed through the same integrity path promotion uses

  # BL-1363 closing-a-ticket-is-one-command-02
  Scenario: a refused integrity check leaves the ticket where it was
    Given the integrity check will refuse the close
    When the coordinator closes the ticket
    Then the ticket file is still in the active area
    And nothing is left staged
    And the refusal reason is reported

  # BL-1363 closing-a-ticket-is-one-command-03
  Scenario: every ticket an approval satisfies is closed together
    Given the approved commit satisfies two tickets
    When the coordinator closes the approval
    Then both ticket files are in the done area for their milestone

  # BL-1363 closing-a-ticket-is-one-command-04
  Scenario: a partial close is refused rather than half-applied
    Given the approved commit satisfies two tickets
    And one of them cannot be closed
    When the coordinator closes the approval
    Then neither ticket file has moved
    And the refusal names the ticket that blocked it

  # BL-1363 closing-a-ticket-is-one-command-05
  Scenario: closing does not promote
    When the coordinator closes the ticket
    Then no paused ticket has been promoted
