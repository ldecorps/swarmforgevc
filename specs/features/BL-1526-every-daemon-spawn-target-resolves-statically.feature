Feature: BL-1526 Every daemon spawn target resolves statically

  The daemon's closure walk (master_checkout_drift_lib.bb) follows every
  ["bb" ...] / ["bash" ...] / ["sh" ...] / ["zsh" ...] spawn vector in a reached
  file and reports, never drops, a target it cannot resolve - a skipped edge
  is the blind spot that took production down before BL-1022. The assertion
  that the unresolved list is empty has been red on main since 306509a6b0
  (2026-08-25): handoffd.bb, chase_sweep_lib.bb and expedite_cli.bb spawn
  four targets bound to locals the resolver does not read. This feature is
  that every one of them resolves or is honestly declared, the walk's
  fail-loud contract is untouched, and the edges still land where they do
  today. This ticket lands last of its three siblings and owns the register
  rows for the runner and for BL-1031's feature.

  # BL-1526 spawn-targets-resolve-statically-01
  Scenario: the walk over the real daemon reports no unresolved spawn target
    When the daemon reachability walk runs from handoffd.bb over the real swarmforge/scripts tree
    Then its unresolved list is empty
    And the daemon cycle guard test runner's output has no FAIL line naming "bl1022: every spawn target"

  # BL-1526 spawn-targets-resolve-statically-02
  Scenario: the four edges still land where they landed before
    When the daemon reachability walk runs from handoffd.bb over the real swarmforge/scripts tree
    Then its non-bb spawn record names start_handoff_daemon.sh and close_ticket.sh
    And the closure holds commit_integrity_cli.bb by a spawn edge from chase_sweep_lib.bb and expedite_cli.bb by a spawn edge from handoffd.bb

  # BL-1526 spawn-targets-resolve-statically-03
  Scenario: a target the walk genuinely cannot resolve is still reported by name
    Given a scratch entrypoint whose only spawn is ["bb" mystery "arg"] with mystery bound nowhere in the file
    When the daemon reachability walk runs from that scratch entrypoint
    Then its unresolved list names that entrypoint and the target "mystery"

  # BL-1526 spawn-targets-resolve-statically-04
  Scenario: the expedite stage-runner seam still substitutes the stage runner under test
    Given a stub stage runner that records its argv and exits 0
    When one expedite stage is driven with the stub installed through the seam the ticket documents
    Then the stub was invoked for that stage
    And the daemon reachability walk over expedite_cli.bb reports no unresolved target
