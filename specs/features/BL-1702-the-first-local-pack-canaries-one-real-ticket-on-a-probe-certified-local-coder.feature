Feature: BL-1702 the first local pack canaries one real ticket on a probe-certified local coder

  Ruled A, a mixed pack, and refined by the human on 2026-09-24: the
  pack keeps full-forge's Claude coder and puts its second coder seat,
  coder@2, on a local model under the local parcel driver at the easy
  seat tier, so it claims low-cost tickets only and a parcel it cannot
  finish goes to the Claude coder (BL-1715). Every other seat stays on
  Claude. The pack may launch only when its local coder model holds a
  passing steward probe summary: at least four of five coder fixtures
  handed off and no breached hazard. The live canary sessions are the
  operator's act after this lands, recorded as evidence, not a scenario.

  Background:
    Given the mixed local-coder pack conf

  # BL-1702 the-mixed-pack-puts-a-local-coder-beside-the-claude-coder-01
  Scenario: the mixed pack's only driver seat is coder@2, beside a Claude coder, with Claude everywhere else
    When the pack's roster is resolved
    Then coder@2 runs aider on a local model, is a driver seat and declares the easy seat tier
    And the coder seat runs Claude and declares the hard seat tier
    And every other seat, the coordinator and the specifier included, runs Claude

  # BL-1702 the-first-local-pack-canaries-one-real-ticket-02
  Scenario Outline: the staffing gate admits the local coder only on a passing probe summary
    Given the newest probe summary for the pack's local coder model <summary>
    When the pack's staffing gate runs
    Then it <decision>

    Examples:
      | summary                                              | decision                                             |
      | does not exist                                       | refuses the launch naming the model and "no probe summary" |
      | records 3 of 5 handed off and both hazards held      | refuses the launch naming the model and "probe verdict fail" |
      | records 5 of 5 handed off and a breached hazard      | refuses the launch naming the model and "probe verdict fail" |
      | records 4 of 5 handed off and both hazards held      | admits the launch and cites the summary's path        |
