Feature: Prompt calibration exercises experimental adapter variants against a model via Model Steward evaluate

  # BL-548 (human intake 2026-07-21): closes the PromptEngine ↔ Model Steward feedback
  # loop. PromptEngine composes experimental variants; Model Steward evaluate exercises
  # the real model with each composed prompt; results land in a calibration report.
  # Production adapters are untouched until Slice 3 promote (parked in .feature.draft).
  #
  # SLICE 1 CONTRACT (this file): experiment harness + report artifact only.
  # Depends on BL-546 Slice 2 (adapters + experiment mode) and BL-547 Slice 2
  # (model-steward evaluate ingestion).

  Background:
    Given PromptEngine adapter plugins and experiment mode are available
    And Model Steward evaluate can ingest battery results for a model and role
    And a production adapter is registered for provider "anthropic" model "claude-sonnet-5"

  # BL-548 calibration-run-composes-variants-01
  Scenario: a calibration run composes each experimental variant via PromptEngine
    Given a calibration experiment for model "claude-sonnet-5" role "coder" with variants "v-a" and "v-b"
    When prompt-calibration run is executed
    Then PromptEngine compose is invoked once per variant in experiment mode
    And each invocation uses a distinct experimental adapter id

  # BL-548 calibration-run-evaluates-each-variant-02
  Scenario: a calibration run evaluates each composed variant through Model Steward
    Given a calibration experiment with variants "v-a" and "v-b"
    When prompt-calibration run is executed
    Then model-steward evaluate is invoked once per variant
    And each evaluate call targets the same model and role as the experiment

  # BL-548 calibration-report-records-evidence-03
  Scenario: a calibration run writes a report with per-variant scores and evidence
    Given a calibration experiment with variants "v-a" and "v-b"
    When prompt-calibration run completes
    Then a calibration report artifact exists for the run
    And the report lists each variant with a scorecard summary
    And each variant entry includes a battery evidence pointer
    And each variant entry includes the composed prompt content hash

  # BL-548 production-catalogue-unchanged-04
  Scenario: a calibration run does not mutate the production adapter catalogue
    Given a calibration experiment with variants "v-a" and "v-b"
    When prompt-calibration run completes
    Then the production Prompt Adapter catalogue entry for the target model is unchanged

  # BL-548 experiment-isolation-05
  Scenario: production compose ignores experimental adapters without experiment mode
    Given a calibration experiment has registered variants for model "claude-sonnet-5"
    And SWARMFORGE_PROMPT_EXPERIMENT is unset
    When PromptEngine composes a system prompt for that model in production
    Then the production incumbent adapter is used
    And no experimental variant adapter is applied

  # BL-548 calibration-status-lists-runs-06
  Scenario: calibration status lists recent runs and their completion state
    Given two calibration runs have been recorded
    When prompt-calibration status is requested
    Then the output lists both run ids with their completion state
