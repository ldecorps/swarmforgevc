Feature: Every generated systemd unit can actually start, and its crash-burst guard is real

# BL-366: the operator unit renders `ExecStart=bb /path/to/operator_runtime.bb` — but systemd does
# not search PATH for ExecStart, so the unit fails on every start ("Command bb is not executable").
# The unit that IS the whole point of BL-304 could never have run. Separately,
# `StartLimitIntervalSec=0` is rendered into [Service], where systemd (v230+) silently ignores it —
# so the crash-burst guard the generator's own comment claims to provide does not exist, and a crash
# burst permanently parks the unit in `failed` while `Restart=always` implies it cannot. Both defects
# are caught in one second by `systemd-analyze verify`, which nothing in the suite runs — which is
# exactly why units that cannot start shipped and sat unnoticed. That test IS the fix; the specific
# defects are just today's instances of what it would have caught.

Background:
  Given the deploy tooling renders systemd units for the swarm

# BL-366 systemd-units-can-actually-start-01
Scenario Outline: Every rendered unit is valid systemd
  When the "<unit>" unit is rendered
  Then systemd accepts it as valid
  And it carries no key that systemd will silently ignore

  Examples:
    | unit       |
    | swarm      |
    | operator   |
    | front-desk |

# BL-366 systemd-units-can-actually-start-02
Scenario Outline: A unit can find its interpreter under systemd's own minimal PATH
  Given systemd runs a unit with a minimal PATH that excludes the user's local bin
  When the "<unit>" unit starts
  Then it finds the interpreter it was told to run
  And the scripts it launches find the interpreters they need

  Examples:
    | unit       |
    | swarm      |
    | operator   |
    | front-desk |

# BL-366 systemd-units-can-actually-start-03
Scenario Outline: A crash burst never permanently stops a unit
  Given the "<unit>" unit is running
  When it crashes repeatedly in a short burst
  Then systemd keeps restarting it
  And it never parks in a failed state it will not leave on its own

  Examples:
    | unit       |
    | swarm      |
    | operator   |
    | front-desk |
