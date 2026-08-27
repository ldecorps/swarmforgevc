Feature: BL-559 acceptance feature gains pipeline step handlers that run the real property suite

  # BL-734: BL-559's feature exists but had zero specs/pipeline/steps handlers;
  # landing only flipped yaml + evidence while the real fix (9b211456a) predated
  # the ticket. Specifier pin: wire handlers (do not retire the feature) so
  # `node specs/pipeline/cli.js` against BL-559 completes with no unmatched
  # steps and asserts the live vitest property suite (7/7), matching what is
  # already on main. Companion pilot process: BL-735 (done).

  Background:
    Given the feature file specs/features/BL-559-pipelineboard-property-test-prefix-substring-bug.feature exists
    And step handlers for that feature are registered under specs/pipeline/steps/

  # BL-734 bl559-cli-no-unmatched-01
  Scenario: running the BL-559 feature via the acceptance CLI matches every step
    When the acceptance pipeline runs specs/features/BL-559-pipelineboard-property-test-prefix-substring-bug.feature
    Then no step fails with "no step handler matched"
    And the run completes with a passing or failing scenario result rather than an unmatched-handler abort

  # BL-734 bl559-handlers-run-vitest-02
  Scenario: the wired handlers execute the real pipelineBoard property vitest suite
    When the acceptance pipeline runs the BL-559 "all seven properties pass" scenario
    Then the handlers invoke vitest against test/pipelineBoard.property.test.js under the properties config
    And all seven properties pass

  # BL-734 bl559-prefix-and-counterexample-wired-03
  Scenario: the remaining BL-559 scenarios are also handler-backed
    When the acceptance pipeline runs the BL-559 multi-seed and minimal-counterexample scenarios
    Then each scenario has matching step handlers
    And none abort for an unmatched step

  # BL-734 bl559-done-notes-provenance-04
  Scenario: BL-559's done ticket notes record that the fix rode a pre-existing commit
    Given backlog/done carries BL-559-pipelineboard-property-test-prefix-substring-bug.yaml
    When BL-734 lands
    Then that ticket's notes state the property-oracle fix predated BL-559's own landing commits
    And the acceptance field still points at the now-wired feature file
