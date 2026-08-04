Feature: BL-804 babysitter health sweep is mono-router topology aware

  Under `config rotation router` only two sessions stand: the resident
  (first non-coordinator roles.tsv session) and the coordinator. The
  deterministic health sweep must judge session absence against the
  resolved topology, not against roles.tsv alone — a dormant role's
  missing session is the designed state, never a CRIT. Every other
  observation is unchanged: absence of a session that SHOULD stand, and
  any defect on a pane that actually exists, still reports exactly as
  today.

  Background:
    Given a fixture project root with a .swarmforge directory
    And a roles.tsv listing eight roles whose first non-coordinator session is the resident

  # BL-804 babysitter-mono-router-topology-awareness-01
  Scenario: dormant-role absence is quiet on a green router sweep
    Given the swarm-identity rotation key declares router
    And the resident and coordinator sessions are alive with claude processes
    And every dormant role session is absent
    And every other health signal is green
    When the sweep assembles findings
    Then no finding names a dormant role
    And the sweep reports OK all checks green

  # BL-804 babysitter-mono-router-topology-awareness-02
  Scenario: router mode is honored from the active pack conf when identity lacks a rotation key
    Given the swarm-identity has no rotation key and records an active pack conf declaring rotation router
    And every dormant role session is absent
    When the sweep assembles findings
    Then no finding names a dormant role

  # BL-804 babysitter-mono-router-topology-awareness-03
  Scenario Outline: a missing required session is still CRIT under router mode
    Given the swarm-identity rotation key declares router
    And the <required-session> session is absent
    When the sweep assembles findings
    Then a CRIT finding reports the <required-session> session missing

    Examples:
      | required-session |
      | resident         |
      | coordinator      |

  # BL-804 babysitter-mono-router-topology-awareness-04
  Scenario: a live dormant pane is still fully checked under router mode
    Given the swarm-identity rotation key declares router
    And a dormant role session exists with no claude process under it
    When the sweep assembles findings
    Then a CRIT finding reports that role's pane alive without a claude process

  # BL-804 babysitter-mono-router-topology-awareness-05
  Scenario: non-router topology keeps per-role absence findings unchanged
    Given no rotation router declaration exists in identity or conf
    And the cleaner session is absent
    When the sweep assembles findings
    Then a CRIT finding reports the cleaner session missing
