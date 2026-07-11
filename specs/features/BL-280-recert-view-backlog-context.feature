Feature: The phone recert view shows the backlog item a scenario belongs to, with tap-through

  Background:
    Given the phone recert view is showing a scenario for recertification

  # BL-280 recert-context-01
  Scenario: the recert card shows the scenario's ticket id and title
    Given the scenario resolves to a backlog ticket
    When the recert card is rendered
    Then it shows the ticket's id and title above the scenario

  # BL-280 recert-context-02
  Scenario: tapping the ticket line opens the full ticket detail
    Given the scenario resolves to a backlog ticket
    When the caller taps the ticket line
    Then the ticket's full detail opens in the docs explorer

  # BL-280 recert-context-03
  Scenario: the localized ticket title is respected
    Given the active locale is French and the ticket has a French title
    When the recert card is rendered
    Then the French title is shown

  # BL-280 recert-context-04
  Scenario: a scenario with no resolvable ticket degrades gracefully
    Given the scenario has no resolvable ticket
    When the recert card is rendered
    Then only the scenario's ticket id is shown, with no link and no error
