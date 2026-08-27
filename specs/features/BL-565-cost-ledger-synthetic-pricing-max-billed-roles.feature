Feature: Cost ledger captures Max-billed role tokens and synthetic list-price dollars

  # BL-565: BL-551 ledger ranks Max-subscription pipeline roles by invocation
  # count only — tokens and costUsd stay null. This slice populates tokens at
  # record time (prefer GH-22 context-telemetry / transcript usage; degrade to
  # null without blocking delivery) and adds syntheticCostUsd from the committed
  # list-price table, kept DISTINCT from costUsd. Rollups label billed vs
  # synthetic separately — never summed silently. depends_on BL-551 (done).

  Background:
    Given the LLM cost ledger stores llm_invocation records per BL-551
    And a committed list-price table with an as_of date labels synthetic estimates

  # BL-565 pipeline-record-carries-tokens-01
  Scenario: a pipeline-role record carries tokens when usage was observable
    Given a pipeline handoff delivery wakes a role whose turn usage is observable
    When an llm_invocation record is appended for that delivery
    Then the record carries non-null input and output token counts at minimum
    And delivery completes even if token capture fails

  # BL-565 unobservable-usage-degrades-null-02
  Scenario: when usage was not observable the record keeps today's null-token shape
    Given a pipeline invocation whose per-turn usage cannot be read
    When an llm_invocation record is appended
    Then the record tokens field is null
    And the handoff or reap path still completes without error

  # BL-565 synthetic-distinct-from-billed-03
  Scenario: syntheticCostUsd is computed for unbilled token records and stays separate from costUsd
    Given an llm_invocation record with non-null tokens and a model in the price table
    And the record has no provider-billed cost
    When synthetic cost is derived for that record
    Then syntheticCostUsd is a positive estimate from list prices
    And costUsd remains null

  # BL-565 billed-cost-unchanged-04
  Scenario: a truly billed OpenRouter row keeps costUsd and does not fake synthetic
    Given an llm_invocation record with a provider-reported costUsd
    When rollups classify the record
    Then costUsd counts toward billed totals
    And syntheticCostUsd is not substituted for the billed amount

  # BL-565 rollups-separate-columns-05
  Scenario: CLI cost-rank and bridge rollups show billed and synthetic as separate labelled totals
    Given priced billed records and Max-billed records with syntheticCostUsd in the same window
    When the 7 day horizon rollup runs via swarm-cost-rank or the cost rank endpoint
    Then the output shows a billed total and a synthetic estimate total as separate labelled values
    And they are never summed together silently

  # BL-565 unknown-model-unknown-price-bucket-06
  Scenario: a model missing from the price table yields null synthetic and an unknown-price bucket
    Given an llm_invocation record with tokens and a model id absent from the price table
    When synthetic cost is derived
    Then syntheticCostUsd is null
    And the rollup counts it in an unknown-price bucket
    And the rollup does not treat it as zero dollars or crash

  # BL-565 role-rollup-ranks-by-synthetic-07
  Scenario: the 7 day per-role rollup ranks Max-billed roles by synthetic dollars not invocation count alone
    Given Max-billed pipeline roles with syntheticCostUsd on their records
    And an OpenRouter-billed role with real costUsd
    When the 7 day rollup groups by role
    Then Max-billed roles are ordered by summed syntheticCostUsd descending
    And invocation count alone is not the only ranking signal for those roles

  # BL-565 prefers-existing-telemetry-08
  Scenario: token capture reuses existing context-telemetry or transcript usage before a new collector
    When pipeline writers populate tokens on llm_invocation records
    Then they read from the existing context-telemetry or transcript usage path
    And they do not introduce a parallel unsupervised usage collector when that path suffices

  # BL-565 sidecar-labels-estimate-09
  Scenario: the cost health sidecar labels synthetic lines as estimates with pricing table as_of
    Given rollups include synthetic totals for a horizon
    When the daily cost health sidecar is emitted
    Then synthetic lines are labelled as estimates
    And the output names the pricing table as_of date
