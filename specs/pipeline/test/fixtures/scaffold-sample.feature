Feature: scaffold sample feature

  Background:
    Given a background precondition is set up

  Scenario: first plain scenario
    When the first plain action happens
    Then the first plain result is checked

  Scenario: second plain scenario
    When the second plain action happens
    Then the second plain result is checked

  Scenario Outline: an outlined scenario with a placeholder
    When the principal uses "<mode>"
    Then the outcome for "<mode>" is recorded

    Examples:
      | mode    |
      | fast    |
      | careful |
