Feature: lifecycle script names and the teardown path state their true scope

  # BL-637: kill_all_swarm.sh does not kill all (pipeline only — no babysitter,
  # operator runtime, front desk, onboarder, tunnels); ./swarm-kill is the
  # counterpart to ./swarm, not to ./start-swarm.sh. The operator's own durable
  # teardown note named the narrow script and left ancillaries running for
  # fifteen days undetected. Fix is naming/discoverability plus a stop path
  # that VERIFIES rather than assumes. The babysitterd-survivor scenario below
  # covers the operator-launched `.swarmforge/operator/babysitterd.sh` process,
  # which is untracked operator-layer state (see BL-611) — this scenario
  # describes the desired stop-path behaviour; wiring it may land with or
  # depend on BL-611's tracked port.

  # BL-637 entry-point-states-its-scope-01
  Scenario Outline: an entry point's name or --help states its scope unambiguously
    When a reader who has never seen the repo runs "<entry point> --help"
    Then the output states "<stated scope>"

    Examples:
      | entry point       | stated scope        |
      | kill_all_swarm.sh  | pipeline-only        |
      | ./swarm-kill       | pipeline-only        |
      | ./stop-swarm.sh    | full stack           |
      | ./start-swarm.sh   | full stack           |

  # BL-637 existing-callers-keep-working-02
  Scenario: the flow-watchdog's endless-loop hard stop still fires after any rename
    Given the flow-watchdog detects three consecutive NO_TASK chase observations
    When it invokes its configured hard-stop entry point
    Then every role agent, handoffd, and its supervisor are terminated
    And ".swarmforge/daemon/kill-all-audit.log" is written

  # BL-637 start-stop-pairing-discoverable-03
  Scenario: every component with a start entry point documents how to stop it
    Given a lifecycle component has a start_* or launch_* entry point
    When its --help is read
    Then the corresponding stop entry point is named

  # BL-637 stop-path-detects-surviving-babysitter-04
  Scenario: the full-stack stop refuses "clean slate" while the operator-launched babysitter survives
    Given the operator-launched babysitterd process is running
    When "./stop-swarm.sh" completes its teardown steps
    Then it does not report a clean slate
    And it names the surviving babysitter process

  # BL-637 stop-path-detects-surviving-operator-agent-05
  Scenario: the full-stack stop refuses "clean slate" while the Operator agent survives
    Given the Operator remote-control agent process is running
    When "./stop-swarm.sh" completes its teardown steps
    Then it does not report a clean slate
    And it names the surviving Operator agent process
