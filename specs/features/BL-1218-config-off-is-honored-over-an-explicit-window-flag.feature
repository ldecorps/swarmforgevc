Feature: config remote_control decides the launched flag, not just the auto-inject default

  The pack config is the desired state for a Claude seat's remote control.
  Today it governs only auto-injection, so a window line that names
  --remote-control itself launches a remote session even under an explicit
  off. Config wins in both directions: off means the flag is not launched or
  persisted whatever the window line says, and on (or absent) leaves today's
  composition, including auto-inject, exactly as it is.

  Background:
    Given a Claude window line for role "coder"

  # BL-1218 config-off-honored-at-launch-01
  Scenario Outline: the effective config decides the flag, whatever the window line names
    Given the window line <window_line> a remote-control flag
    And the pack config sets remote control to "<config>"
    When the launch script for "coder" is composed
    Then the launch script <outcome> a remote-control flag

    Examples:
      | window_line | config | outcome     |
      | names       | off    | carries no  |
      | omits       | off    | carries no  |
      | names       | on     | carries     |
      | omits       | on     | carries     |

  # BL-1218 config-off-honored-at-launch-02
  Scenario: an absent remote-control config behaves exactly as on
    Given the window line names a remote-control flag
    And the pack config names no remote control setting
    When the launch script for "coder" is composed
    Then the launch script carries a remote-control flag

  # BL-1218 config-off-honored-at-launch-03
  Scenario: the persisted script agrees with the config that wrote it
    Given the window line names a remote-control flag
    And the pack config sets remote control to "off"
    When the launch script for "coder" is composed
    And the remote-control health check reads that launch script
    Then the health check reports "coder" as off

  # BL-1218 config-off-honored-at-launch-04
  Scenario: a non-Claude seat is unaffected by the config
    Given a non-Claude window line for role "coder"
    And the pack config sets remote control to "on"
    When the launch script for "coder" is composed
    Then the launch script carries no remote-control flag
