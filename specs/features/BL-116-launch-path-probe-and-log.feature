Feature: launches find their tools and leave a durable trace

# BL-116 path-probe-01
Scenario: login-shell PATH is probed once and merged
  Given the user's login shell reports directories missing from
    process.env.PATH
  When the extension resolves the launch PATH
  Then the probed directories are merged in
  And the probe runs at most once per activation (cached thereafter)

# BL-116 path-probe-02
Scenario: probe failure falls back to the hardcoded list
  Given the login-shell probe fails or times out
  When the extension resolves the launch PATH
  Then the current hardcoded directory list is used
  And launching still works as it does today on macOS

# BL-116 launch-log-03
Scenario Outline: every launch attempt persists its outcome
  Given a launch attempt that <outcome>
  When the attempt finishes
  Then .swarmforge/last-launch.log contains the ./swarm stdout and
    stderr and the final LaunchResult

  Examples:
    | outcome  |
    | succeeds |
    | fails    |

# Non-behavioral gates:
#  - Probe uses a short timeout and never blocks activation.
#  - Tested through the existing swarmLauncher seams (fake shell probe,
#    fake fs); no live tmux in tests.
