Feature: BL-1136 stamp-off of Cursor hotfix fbf6f1a909
  Commit fbf6f1a909 is a human-landed hotfix already on local main with
  Hotfix-Certification: pending. It pulses babysitterd heartbeats at
  process start and tick start+end (BL-1133's acceptance surface, landed
  early) and drops invalid `config rotation standing` from
  cursor-forge.conf so the pack launches again.

  This ticket stamps that landed work off — confirm or refute, do not
  reimplement. BL-1133 remains the product owner of the babysitterd
  heartbeat contract; this stamp dual-cites it and adds the pack-parse
  half. A human certifies or waives via Approvals and the hotfix ledger;
  green tests alone never certify.

  # BL-1136 babysitterd-pulse-helper-01
  Scenario: babysitterd defines a content-free pulse_heartbeat helper
    Given the source of swarmforge/scripts/babysitterd.sh at commit fbf6f1a909
    When the pulse helper is inspected
    Then it defines a pulse_heartbeat function that appends a heartbeat line to the daemon log

  # BL-1136 babysitterd-start-and-tick-pulses-02
  Scenario: babysitterd pulses at process start and at tick start and end
    Given the source of swarmforge/scripts/babysitterd.sh at commit fbf6f1a909
    When the cold-start path and the tick function are inspected
    Then pulse_heartbeat is invoked before the first tick loop iteration
    And pulse_heartbeat is invoked at the start of tick before babysitter_check
    And pulse_heartbeat is invoked at the end of tick after babysitter_check returns

  # BL-1136 cursor-forge-omits-rotation-standing-03
  Scenario: cursor-forge.conf no longer declares invalid rotation standing
    Given the source of swarmforge/packs/cursor-forge.conf at commit fbf6f1a909
    When the pack config lines are inspected
    Then there is no config rotation standing line
    And the pack does not set config rotation to any value other than sequential or router
