# mutation-stamp: sha256=020ba8126df1e1616c2e55d792e28cb0cef93bb5c0dc4447b401181e6ade0775
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T02:34:40.586228275Z","feature_name":"Every generated systemd unit can actually start, and its crash-burst guard is real","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-366-systemd-units-can-actually-start.feature","background_hash":"d0e20f3654f9f86ec39a14558f313bd11ec7da65b19578a1486cb9e92bf7d9cc","implementation_hash":"unknown","scenarios":[{"index":0,"name":"Every rendered unit is valid systemd","scenario_hash":"45ad7f8525d4b5e6dbafdf51bf557b71fe00c4f102894fe2906f5cfb76c79fa1","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T02:34:40.586228275Z"},{"index":1,"name":"A unit can find its interpreter under systemd's own minimal PATH","scenario_hash":"ac7b0dd03788aabee90e43988fc7638af9a7d99b45000652c00b0818830466e9","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T02:34:40.586228275Z"},{"index":2,"name":"A crash burst never permanently stops a unit","scenario_hash":"959c3c7c7baf6c2170932f806d9717371289607604c621d408aec6e70aec087c","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T02:34:40.586228275Z"}]}
# acceptance-mutation-manifest-end

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
