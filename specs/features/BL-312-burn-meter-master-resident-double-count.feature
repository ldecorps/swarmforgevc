Feature: Master-resident roles report combined usage instead of double-counted identical totals

  # BL-312 burn-meter-master-resident-01
  Scenario: two roles sharing one worktreePath report one combined total
    Given the coordinator and specifier roles share the same worktreePath
    And that worktree's transcripts record a known amount of usage
    When burn-rate and cost-sidecar attribution run
    Then the coordinator and specifier are reported as one combined/shared usage total

  # BL-312 burn-meter-master-resident-02
  Scenario: the combined total is not double-counted in the day aggregate
    Given the coordinator and specifier roles share the same worktreePath
    And that worktree's transcripts record a known amount of usage
    When the day's aggregate cost total is computed
    Then the shared worktree's usage is counted exactly once toward the total

  # BL-312 burn-meter-master-resident-03
  Scenario: a role on its own distinct worktreePath is unaffected
    Given a role whose worktreePath is not shared with any other current roster role
    When burn-rate and cost-sidecar attribution run
    Then that role's usage is reported exactly as it is today
