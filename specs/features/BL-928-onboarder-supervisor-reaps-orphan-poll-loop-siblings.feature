Feature: An onboarder supervisor start leaves exactly one live reconcile poll-loop for its own root
  A supervisor that dies without running its `finally` (SIGKILL, crash, host
  kill of the bb process) reparents its reconcile child to PID 1, and
  `stop_onboarder()` then deletes the status file that recorded it. The next
  supervisor's `"not-started"` branch spawns a fresh child without ever
  looking for siblings, so every unreaped leftover accumulates alongside it -
  two were measured live on 2026-08-18 (19h and 11h old) beside a healthy
  3h-old pair. They share the heartbeat file the stall detector reads and
  duplicate outbound topic-ensure calls. A supervisor start now sweeps
  orphaned poll-loops of its own root first.

  Background:
    Given an onboarder supervisor about to start for a swarm repo root

  # BL-928 onboarder-orphan-sibling-reap-01
  Scenario: leftover poll-loops for this root are reaped before the supervisor's own child spawns
    Given two orphaned onboarder-reconcile poll-loop processes for that swarm repo root
    When the onboarder supervisor starts
    Then both orphaned poll-loop processes are dead
    And the supervisor starts and spawns its own child
    And exactly one live onboarder-reconcile poll-loop process remains for that swarm repo root
    And the supervisor status file records exactly one live pid

  # BL-928 onboarder-orphan-sibling-reap-02
  Scenario Outline: a process the sweep must not touch survives the startup reap
    Given one <candidate> process
    When the onboarder supervisor starts
    Then that process is still alive
    And the supervisor starts and spawns its own child

    Examples:
      | candidate                                                          |
      | onboarder-reconcile poll-loop whose parent process is still alive  |
      | onboarder-reconcile poll-loop for a different swarm repo root      |
      | orphaned node process for that swarm repo root that is not a poll-loop |

  # BL-928 onboarder-orphan-sibling-reap-03
  Scenario: an unreadable process table reaps nothing and never blocks the start
    Given the host process table cannot be enumerated
    And one orphaned onboarder-reconcile poll-loop process for that swarm repo root
    When the onboarder supervisor starts
    Then no process is reaped
    And the supervisor starts and spawns its own child
    And the supervisor log records that the sweep could not read the process table

  # BL-928 onboarder-orphan-sibling-reap-04
  Scenario: a clean host reaps nothing and logs no sweep failure
    Given no other onboarder-reconcile poll-loop process for that swarm repo root
    When the onboarder supervisor starts
    Then no process is reaped
    And the supervisor starts and spawns its own child
    And the supervisor log records no process-table read failure
