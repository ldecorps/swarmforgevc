Feature: start-swarm survives launch from a harness-descended shell

  # BL-657: three identical failures in one night — start-swarm launched from
  # an operator/harness-descended shell (a shell with CLAUDE_CODE_CHILD_SESSION
  # or similar markers in its environment) creates both tmux sessions, then the
  # whole tmux SERVER process dies 1-3 seconds later, while a cron-launched
  # start and a manual session assembly both survive. The reproduction kit
  # points at an inherited environment marker interacting with launch_role's
  # respawn-time env args, but the root cause was still open at filing time —
  # these scenarios pin the externally observable contract the fix must meet,
  # not a specific mechanism.

  # BL-657 harness-descended-launch-survives-01
  Scenario: a launch from a harness-descended shell survives past the failure window
    Given a shell descended from an operator/harness session
    When start-swarm.sh launches the swarm from that shell
    Then both swarm sessions still exist 60 seconds after launch
    And the tmux server process is still running

  # BL-657 cron-launch-unregressed-02
  Scenario: a launch from a clean cron environment is unaffected
    Given a clean cron-launched shell with no harness-descended markers
    When start-swarm.sh launches the swarm from that shell
    Then both swarm sessions still exist 60 seconds after launch
    And the launch behaves exactly as it did before this fix

  # BL-657 role-sessions-never-inherit-transcript-off-03
  Scenario Outline: role sessions never inherit harness transcript-off state
    Given <launching shell> launches the swarm
    When the role sessions are inspected after launch
    Then no role session carries CLAUDE_CODE_CHILD_SESSION or a transcript-off marker

    Examples:
      | launching shell            |
      | a harness-descended shell  |
      | a clean cron shell         |
      | a plain interactive shell  |

  # BL-657 failed-launch-leaves-readable-cause-04
  Scenario: a failed launch reports a diagnosable cause, not only "did not become ready"
    Given a launch attempt whose swarm sessions do not survive to become ready
    When wait_for_ready reports the failure
    Then the failure report includes either a frozen canary pane state or a tmux server log path
    And the report is never only the bare "swarm did not become ready" message

  # BL-657 expeditor-restart-succeeds-05
  Scenario: the Expeditor's restart half succeeds from an expedition run
    Given an expedition has stopped the full stack and is restarting it
    When the Expeditor's EXPEDITE_START_CMD runs
    Then the swarm becomes ready and its sessions survive 60 seconds after restart
