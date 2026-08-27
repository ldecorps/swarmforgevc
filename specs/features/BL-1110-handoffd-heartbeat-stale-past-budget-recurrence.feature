Feature: BL-1110 handoffd's heartbeat must not go stale past the freshness budget after BL-967/BL-1021
  On 2026-08-23 the Operator surface showed handoffd restarted for
  stale-heartbeat (threshold 120s), then FRESHNESS_VIOLATION escalate, then
  another restart — while the host was not under severe load. Prior work
  (BL-967, BL-1021) already addressed earlier freshness restart storms; this
  is a recurrence with a new cause, not a missing alert.

  Do not "fix" by raising the 120s threshold alone. Find why the heartbeat
  file aged past budget again (delivery loop stall, restart/claim race, or
  another measured cause) and close that path.

  Background:
    Given daemon_log_freshness.conf pins handoffd freshness at 120 seconds
    And handoffd is the live delivery daemon for the primary swarm

  # BL-1110 handoffd-heartbeat-01
  Scenario: a healthy delivery loop keeps the heartbeat younger than the budget
    Given handoffd is running and delivering without an injected stall
    When freshness is sampled for one full budget window
    Then the heartbeat age stays under 120 seconds
    And no stale-heartbeat restart is issued for handoffd

  # BL-1110 handoffd-heartbeat-02
  Scenario: a restart race that fails to claim the pidfile is recorded, never silent flap
    Given a freshness restart is attempted while another handoffd still holds the pidfile
    When the claim fails
    Then the failure is logged as a pid-claim refusal
    And the supervisor does not enter an unbounded restart flap for that refusal alone

  # BL-1110 handoffd-heartbeat-03
  Scenario: the freshness budget stays at 120 unless a named root-cause fix lands with any change
    Given the defect under this ticket is under review
    When the landed fix is inspected
    Then either handoffd remains pinned at 120 seconds in daemon_log_freshness.conf, or any threshold change lands in the same parcel as a named root-cause fix
