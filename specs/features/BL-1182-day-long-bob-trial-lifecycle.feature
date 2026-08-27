Feature: day-long BoB trial nominates assesses and promotes or reverts

  # BL-1182 (epic BL-1180). Nominate → one-day seat → assess → promote/revert.
  # Tie → cheapest wins. Live production trials still gated by BL-1183.

  Background:
    Given Model Steward can nominate certified candidates for a role

  # BL-1182 nominate-arms-day-trial-01
  Scenario: steward nomination arms a one-day trial seat for a role
    Given a candidate that might outrank the permanent model for role "coder"
    When the steward nominates that candidate for trial
    Then a one-day trial is armed on a swarm seat for that role

  # BL-1182 outrank-promotes-02
  Scenario: an outranking trial becomes the new permanent model
    Given a day trial that effectively outranks the permanent model
    When end-of-day assessment completes
    Then the trialled model becomes permanent for that role

  # BL-1182 tie-cheapest-wins-03
  Scenario: a tie selects the cheaper cost class
    Given a day trial that ties the permanent model on performance
    And the trialled model has a cheaper cost class
    When end-of-day assessment completes
    Then the cheaper model becomes permanent for that role

  # BL-1182 lose-reverts-with-evidence-04
  Scenario: a losing trial reverts and records steward evidence
    Given a day trial that loses to the permanent model
    When end-of-day assessment completes
    Then the seat reverts to the permanent model
    And steward evidence records the loss against silent re-trial

  # BL-1182 boundaries-transfer-memory-05
  Scenario: trial start and end transfer agent memory on the same role
    When a trial starts or ends with a model change for one role
    Then agent-memory transfer runs before live work resumes
