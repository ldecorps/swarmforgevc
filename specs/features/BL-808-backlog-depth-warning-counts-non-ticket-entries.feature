Feature: the backlog depth warning counts tickets, not directory entries

  # BL-808: check-backlog-depth in swarm_handoff.bb counts every entry in
  # backlog/active/ via (count (fs/list-dir active-dir)), so the tracked
  # .gitkeep placeholder counts as a ticket. With one real ticket active and a
  # cap of 1 the send prints "active=2, max=1" on every handoff — a false alarm
  # on a real control.
  #
  # Every OTHER site that counts active tickets already filters to *.yaml:
  # promotion_gates_lib/active-count, chase_sweep_lib/count-backlog-yaml,
  # babysitter_check, expedite_cli, and swarm_handoff's own line 395. This one
  # line is the sole outlier, which is why the load-bearing property below is
  # agreement between the warning and the gate rather than any single number.
  #
  # Specifier note: `outcome` takes exactly two values, `silent` and `warned` —
  # a named outcome, so the step handler validates against a known set rather
  # than passing the cell through as a boolean.

  Background:
    Given a backlog/active/ directory containing the tracked .gitkeep placeholder

  # BL-808 warning-tracks-ticket-count-only-01
  Scenario Outline: the warning fires on the ticket count alone
    Given the active backlog cap is <cap>
    And <tickets> ticket yamls are active
    When a handoff is sent
    Then the depth warning outcome is <outcome>

    Examples:
      | cap | tickets | outcome |
      | 1   | 1       | silent  |
      | 1   | 2       | warned  |
      | -1  | 2       | silent  |
      | 0   | 0       | silent  |

  # BL-808 filtered-by-kind-not-by-name-02
  # The fix must select ticket yamls, NOT blocklist the one placeholder that
  # happens to be there today — so each row is an entry no .gitkeep-specific
  # exclusion would catch.
  Scenario Outline: entries that are not ticket yamls are never counted
    Given the active backlog cap is 1
    And 1 ticket yamls are active
    And the active directory also contains <entry>
    When a handoff is sent
    Then the depth warning outcome is silent

    Examples:
      | entry              |
      | a README.md file   |
      | a nested directory |

  # BL-808 breach-reports-the-real-count-03
  Scenario: a real breach reports the ticket count, not the entry count
    Given the active backlog cap is 1
    And 2 ticket yamls are active
    When a handoff is sent
    Then the depth warning outcome is warned
    And it reports the active count as 2

  # BL-808 warning-agrees-with-promotion-gate-04
  Scenario Outline: the warning's count agrees with the promotion gate's count
    Given the active backlog cap is 1
    And <tickets> ticket yamls are active
    When the depth warning's active count and the promotion gate's active count are compared
    Then the two counts are equal

    Examples:
      | tickets |
      | 0       |
      | 1       |
      | 2       |
