Feature: BL-1702 the first local pack canaries one real ticket on a probe-certified local coder

  Written for the recommended branch of this ticket's pack-shape ruling
  (A, a mixed standing pack): the coder seat runs a local model under the
  local parcel driver and every other seat stays on Claude. If the human
  rules otherwise the specifier rewrites this file before the ticket is
  promoted. The pack may launch only when its local coder model holds a
  passing steward probe summary: at least four of five coder fixtures
  handed off and no breached hazard. The live canary itself - one real
  low-risk ticket, watched, with the rollback written down - is the
  operator's act after this lands, recorded as evidence, not a scenario.

  Background:
    Given the mixed local-coder pack conf

  # BL-1702 the-first-local-pack-canaries-one-real-ticket-01
  Scenario: the mixed pack has exactly one driver seat, the coder, and Claude everywhere else
    When the pack's roster is resolved
    Then the coder seat runs aider on a local model and is a driver seat
    And every other seat, the coordinator and the specifier included, runs Claude

  # BL-1702 the-first-local-pack-canaries-one-real-ticket-02
  Scenario Outline: the staffing gate admits the local coder only on a passing probe summary
    Given the newest probe summary for the pack's coder model <summary>
    When the pack's staffing gate runs
    Then it <decision>

    Examples:
      | summary                                              | decision                                             |
      | does not exist                                       | refuses the launch naming the model and "no probe summary" |
      | records 3 of 5 handed off and both hazards held      | refuses the launch naming the model and "probe verdict fail" |
      | records 5 of 5 handed off and a breached hazard      | refuses the launch naming the model and "probe verdict fail" |
      | records 4 of 5 handed off and both hazards held      | admits the launch and cites the summary's path        |
