Feature: Same-model stage seats bypass tier filtering

  # When every seat of a stage declares the same effective --model, BL-1001
  # tier rules must not suppress claim eligibility. BL-983 idle-first routing
  # among seats applies instead. Tier discipline returns when models differ.

  Background:
    Given a coder stage with two seats both declared for the same model

  # BL-1167 medium-cost-claims-easy-seat-when-same-model-01
  Scenario: A medium-cost ticket may be claimed by the easy-tier seat when both seats share the same model
    Given a ticket whose mutation_cost is medium
    And both coder seats are idle
    When the easy-tier seat polls for work
    Then that seat may claim the ticket

  # BL-1167 high-cost-claims-easy-seat-when-same-model-02
  Scenario: A high-cost ticket may be claimed by the easy-tier seat when both seats share the same model and the hard seat is busy
    Given a ticket whose mutation_cost is high
    And the hard-tier seat is busy
    And the easy-tier seat is idle
    When the easy-tier seat polls for work
    Then that seat may claim the ticket

  # BL-1167 tier-rules-return-when-models-differ-03
  Scenario: Tier filtering applies when the two seats declare different models
    Given the two coder seats declare different models
    And a ticket whose mutation_cost is high
    And the hard-tier seat is busy
    And the easy-tier seat is idle
    When the easy-tier seat polls for work
    Then that seat must not claim the ticket
