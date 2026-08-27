Feature: collectReferencedClaudeModels meets the CRAP gate with fixture-driven coverage

  # BL-740: BL-627's collectReferencedClaudeModels landed at CRAP=10.89 with
  # incomplete branch coverage. Fixture tests now drive packs/, launch/, skip
  # rules, and conf-absent paths; helper extracted to addClaudeModelsFromDir.

  Background:
    Given the BL-740 pricing table acceptance scope

  # BL-740 pricing-table-tests-01
  Scenario: BL-740 pricing table unit tests pass
    When the BL-740 pricing table unit tests run
    Then every BL-740 pricing table unit test passes

  # BL-740 bl627-regression-02
  Scenario: BL-627 pricing table regression stays green
    When the BL-627 pricingTable regression tests run
    Then every BL-627 pricingTable regression test passes

  # BL-740 crap-gate-03
  Scenario: collectReferencedClaudeModels reports CRAP at most 6
    When a scoped CRAP report runs for pricingTable.ts
    Then collectReferencedClaudeModels reports CRAP at most 6
    And addClaudeModelsFromDir reports CRAP at most 6
