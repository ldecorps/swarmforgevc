# mutation-stamp: sha256=69a711524e957e0b29a5a1b8d3f8dadb0f672f25e7f07c52d1d4a47b89e9b7d0
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-26T03:16:55.294925607Z","feature_name":"BL-1700 the model steward probes a local coder model through the real driver","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1700-the-model-steward-probes-a-local-coder-model-through-the-real-driver.feature","background_hash":"a0d5940e18ad0bb9317cd05c7f7108a11d32c543d5516069c14f6f5b0aba0c13","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the summary applies the four-of-five coder bar","scenario_hash":"d4251230d492fa30ee4fc61ebba9b051f1a1cb07c16055dd187979b5df264b29","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-09-26T03:16:55.294925607Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1700 the model steward probes a local coder model through the real driver

  Whether a local model can do the coder's job is only measurable with
  the model itself: T1 tests prove the driver's plumbing with a stand-in,
  never the model. The steward's probe runs the real BL-1697 driver
  against a real aider seat on a named model, inside a throwaway
  repository built per run from committed fixture tickets whose
  acceptance tests start red, with a turn cap and a wall-clock cap, and
  writes a scorecard per run and one summary. A model passes the coder
  bar when at least four of the five fixture tickets are handed off with
  the spec untouched. The probe never touches the live repository or the
  live router. These scenarios drive the harness with a stand-in aider;
  the real-model runs are evidence, not scenarios.

  Background:
    Given the probe harness with its five committed coder fixture tickets
    And a stand-in aider that plays a scripted model

  # BL-1700 the-model-steward-probes-a-local-coder-model-01
  Scenario Outline: the summary applies the four-of-five coder bar
    Given the stand-in model solves <solved> of the five fixture tickets with the spec untouched
    When the steward probes the model on the coder scenarios
    Then the summary records <solved> of 5 handed off and the verdict "<verdict>"
    And one scorecard per fixture ticket names its outcome and wall time

    Examples:
      | solved | verdict |
      | 5      | pass    |
      | 4      | pass    |
      | 3      | fail    |

  # BL-1700 the-model-steward-probes-a-local-coder-model-02
  Scenario: a handoff with a changed spec is scored as a failure, never a pass
    Given the stand-in model solves the fixture ticket by editing its acceptance test
    When the steward probes the model on one fixture ticket
    Then its scorecard records the outcome "spec changed" and does not count it as handed off

  # BL-1700 the-model-steward-probes-a-local-coder-model-03
  Scenario: a run that exceeds its wall-clock cap is stopped and scored
    Given the stand-in aider never returns to its prompt
    And the probe's wall-clock cap is 5 seconds
    When the steward probes the model on one fixture ticket
    Then the run stops within 15 seconds and its scorecard records the outcome "wall-clock cap"
    And no aider or tmux process from the run is left alive

  # BL-1700 the-model-steward-probes-a-local-coder-model-04
  Scenario: every run works in its own throwaway repository and leaves the live one untouched
    When the steward probes the model on the coder scenarios
    Then each run's repository was created under a fresh temporary root and removed afterwards
    And the live repository's HEAD, index and mailboxes are unchanged

  # BL-1700 the-model-steward-probes-a-local-coder-model-05
  Scenario: the probe refuses to start when the model endpoint does not answer
    Given the model endpoint does not answer
    When the steward probes the model on the coder scenarios
    Then it exits non-zero naming the endpoint it probed
    And no scorecard or summary is written
