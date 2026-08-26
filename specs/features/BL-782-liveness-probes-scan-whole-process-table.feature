Feature: expedite_cli liveness probes match only processes belonging to the audited root
  BL-782 (expedite_cli.bb half). BL-730 delivered kill_pipeline_swarm.sh survivor
  scoping; expedite_cli.bb still passes bare needles to pids-matching at
  handoffd, handoffd_supervisor, babysitterd, and operator probes — matching any
  swarm on the host or the operator's standing babysitterd prototype. test_expedite_cli.sh
  false-fails on a live-swarm host when cases do NOT pin EXPEDITE_PROBE_FILE.
  The behavioural bar is a decoy process from a DIFFERENT root alive throughout
  the run; the probe-file seam must not satisfy the pass bar.

  Background:
    Given expedite_cli is auditing project root "/repos/alpha"

  # BL-782 neighbour-root-processes-not-survivors-01
  Scenario Outline: a neighbour swarm process does not count as a liveness survivor
    Given a running process "<argv>"
    When expedite_cli probes liveness without EXPEDITE_PROBE_FILE
    Then that process is not counted as alive for "<probe>"

    Examples:
      | argv                                                              | probe                |
      | bb /repos/beta/swarmforge/scripts/handoffd.bb /repos/beta         | handoffd             |
      | bb /repos/beta/swarmforge/scripts/handoffd_supervisor.bb /repos/beta | handoffd-supervisor |
      | /repos/beta/.swarmforge/operator/babysitterd.sh                     | babysitterd          |

  # BL-782 genuine-root-survivor-still-detected-02
  Scenario Outline: a genuine survivor on the audited root is still detected
    Given a running process "<argv>"
    When expedite_cli probes liveness without EXPEDITE_PROBE_FILE
    Then that process is counted as alive for "<probe>"

    Examples:
      | argv                                                              | probe     |
      | bb /repos/alpha/swarmforge/scripts/handoffd.bb /repos/alpha       | handoffd  |
      | bb /repos/alpha/swarmforge/scripts/handoffd_supervisor.bb /repos/alpha | handoffd-supervisor |

  # BL-782 expedite-suite-passes-with-live-neighbour-swarm-03
  Scenario: test_expedite_cli passes on a host with a live swarm for a different root
    Given real handoffd.bb handoffd_supervisor.bb and babysitterd.sh processes for a different project root are alive throughout the run
    And EXPEDITE_PROBE_FILE is not set for unpinned cases
    When test_expedite_cli.sh runs against its fixture roots
    Then every unpinned case that should pass exits zero

  # BL-782 lifecycle-scope-regression-guard-04
  Scenario: test_lifecycle_script_scope still passes with a neighbour handoffd alive
    Given a real handoffd.bb for a different project root is alive throughout the run
    When test_lifecycle_script_scope.sh runs
    Then the suite exits zero

  # BL-782 operator-probe-scope-or-document-05
  Scenario: the operator remote-control probe scopes to the audited root or documents why it cannot
    Given expedite_cli probes the operator liveness signal
    Then the probe either matches only processes belonging to "/repos/alpha"
    Or the code documents why "--remote-control Operator" cannot be root-scoped by pattern alone
