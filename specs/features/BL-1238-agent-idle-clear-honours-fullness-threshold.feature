Feature: A role clears its context at NO_TASK only when its window is nearly full
  A worker that hits NO_TASK at an idle boundary may clear its context window,
  which re-execs the launch script and re-pays the boot prefix and model
  reload. That cost is worth paying only when the window is nearly full.

  BL-141 shipped this gate for the extension-host idle-clear path. The
  agent-side path roles actually take after done_with_current -
  maybe-clear-at-idle-boundary! in ready_for_next_task.bb and
  ready_for_next_batch.bb - respawns unconditionally whenever idle-clear is
  enabled, so the cost is still paid on a window that is mostly free.

  Opt-in is unchanged: a role that has not enabled idle-clear never clears,
  whatever its fullness.

  Background:
    Given a role has reached an idle boundary with NO_TASK

  # BL-1238 agent-idle-clear-fullness-01
  Scenario Outline: Fullness and opt-in both gate the respawn
    Given the role's idle-clear opt-in is <optin>
    And the role's context window is <fullness> full
    When the role reaches the idle-clear decision
    Then the role <outcome>

    Examples:
      | optin    | fullness | outcome              |
      | enabled  | 90%      | respawns             |
      | enabled  | 75%      | respawns             |
      | enabled  | 74%      | stays in its session |
      | enabled  | 10%      | stays in its session |
      | disabled | 90%      | stays in its session |

  # BL-1238 agent-idle-clear-fullness-02
  Scenario: The threshold comes from configuration, not a literal
    Given the configured fullness threshold is 50%
    And the role's idle-clear opt-in is enabled
    And the role's context window is 60% full
    When the role reaches the idle-clear decision
    Then the role respawns

  # BL-1238 agent-idle-clear-fullness-03
  Scenario Outline: A labelled proxy reading is honoured like a telemetry one
    Given the fullness reading comes from <source>
    And the role's idle-clear opt-in is enabled
    And the role's context window is 80% full
    When the role reaches the idle-clear decision
    Then the role respawns
    And the decision records that the reading came from <source>

    Examples:
      | source    |
      | telemetry |
      | proxy     |

  # BL-1238 agent-idle-clear-fullness-04
  Scenario: An unavailable fullness reading does not trigger a reload
    Given no fullness reading can be obtained
    And the role's idle-clear opt-in is enabled
    When the role reaches the idle-clear decision
    Then the role stays in its session
    And the decision records that no reading was available
