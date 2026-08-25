Feature: a piloted ticket cannot land without its acceptance feature actually executing
  BL-735 (companion BL-734). BL-559 moved paused→done twice (Jul 29, reverted,
  re-landed Jul 30) without ever running its named Gherkin acceptance — only
  prose in commit messages and evidence notes. BL-727 made the pilot land path
  execute acceptance before yaml moves; this slice closes the gap where a
  feature file is present but never invoked, and where revert-then-reland
  tickets lack a visible explanation. Source: BL-723 review of BL-559.

  Background:
    Given the pilot acceptance gate is the only landing path
    And a piloted ticket in backlog/active declares an acceptance feature file

  # BL-735 declared-acceptance-never-executed-refuses-01
  Scenario: a ticket refuses land when its acceptance feature was never executed
    Given the ticket's acceptance feature file exists on disk
    And the acceptance pipeline has not been run for this ticket at this landing attempt
    When the pilot attempts to land the ticket
    Then the land is refused
    And the refusal names that acceptance was declared but not executed

  # BL-735 acceptance-must-run-before-done-move-02
  Scenario: landing moves yaml to done only after a green acceptance run
    Given the ticket's acceptance feature file passes through the acceptance pipeline
    When the pilot lands the ticket
    Then the acceptance pipeline executed before the yaml moved
    And the ticket yaml is moved to backlog/done/
    And an acceptance receipt records the feature file path and passing result

  # BL-735 revert-reland-requires-visible-note-03
  Scenario: a revert-then-relanded ticket carries a visible note explaining the history
    Given a ticket that was previously landed to backlog/done and then reverted to backlog/active
    When the pilot lands the ticket again
    Then the ticket yaml notes explain why the first landing was reverted
    And the notes explain why the reland is warranted

  # BL-735 double-land-without-acceptance-blocked-04
  Scenario: a second done landing without acceptance execution at either attempt is blocked
    Given a ticket that was once landed to backlog/done without an acceptance receipt
    And the ticket was reverted and sits in backlog/active again
    And neither landing attempt executed the acceptance feature
    When the pilot attempts to land the ticket
    Then the land is refused
    And the ticket yaml still sits in backlog/active/

  # BL-735 failed-acceptance-refuses-inert-05
  Scenario: a failed acceptance run refuses land without side effects
    Given the ticket's acceptance feature file fails in the acceptance pipeline
    When the pilot attempts to land the ticket
    Then the land is refused
    And the ticket yaml still sits in backlog/active/
    And no acceptance receipt is written
