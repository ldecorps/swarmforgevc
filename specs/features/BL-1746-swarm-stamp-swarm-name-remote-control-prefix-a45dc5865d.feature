Feature: BL-1746 Swarm stamp for hotfix a45dc5865d - a named swarm's Remote Control sessions carry its name

  Every Claude seat's Remote Control session was named "SwarmForge-<Role>".
  A window line can name its own, but the coordinator is never a window
  line, so two swarms under one account showed two identical
  "SwarmForge-Coordinator" sessions. Hotfix a45dc5865d (2026-09-25) uses
  the swarm's own config swarm_name as the prefix whenever it is set to
  anything but the default "primary". A swarm with no swarm_name keeps the
  names its human has already bookmarked. This feature stamps that
  behaviour against the launcher's real naming function.

  # BL-1746 the-prefix-follows-the-swarm-name-01
  Scenario Outline: a role's Remote Control session name follows the swarm's name
    Given a pack whose swarm_name is <swarm name>
    When the launcher names the <role> seat's Remote Control session
    Then the session name is "<session name>"

    Examples:
      | swarm name       | role        | session name                 |
      | not set          | coordinator | SwarmForge-Coordinator       |
      | not set          | QA          | SwarmForge-QA                |
      | primary          | coder       | SwarmForge-Coder             |
      | GpuBargainHunter | coordinator | GpuBargainHunter-Coordinator |
      | GpuBargainHunter | QA          | GpuBargainHunter-QA          |
