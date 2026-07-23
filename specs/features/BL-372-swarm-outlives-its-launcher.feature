# mutation-stamp: sha256=89fdb68030a6ec5b863a735a27bd10dd1c16a53eba7c5f1e04f3f0df89727c21
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-07-14T04:59:48.762642997Z","feature_name":"A launched swarm outlives whatever launched it","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-372-swarm-outlives-its-launcher.feature","background_hash":"a98b7277360daf6e70b4fbcbb06873a796daf81ae98de85418a02215c0cd7342","implementation_hash":"unknown","scenarios":[{"index":0,"name":"The swarm survives however its caller goes away","scenario_hash":"f22c4158b9c48a1fafbba9b84a42575d42f701c029134a1c073195a7cc06868c","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-07-14T04:59:48.762642997Z"}]}
# acceptance-mutation-manifest-end

Feature: A launched swarm outlives whatever launched it

# BL-372: twice on 2026-07-14 a swarm launched from a disposable Operator window came up correctly —
# 8/8 sessions, panes alive — and then died the moment the caller exited, producing an 8x
# AGENT_EXITED storm minutes later. The next Operator run relaunched, exited, and it happened again:
# a relaunch/reap loop. The agents never crashed; the caller's teardown took them. The tell is that
# `handoffd` from the SAME launch was still alive and init-parented, because `start_handoff_daemon.sh`
# detaches properly — while the swarm's tmux server, which nothing detaches, was simply gone. A swarm
# is a long-lived service; whose shell happened to start it must not decide how long it lives.

Background:
  Given a swarm launcher pointed at a target project

# BL-372 swarm-outlives-its-launcher-01
Scenario Outline: The swarm survives however its caller goes away
  Given the swarm has come up with every role running
  When the caller goes away by <caller_departure>
  Then the swarm's agents are still running
  And the swarm is still controllable

  Examples:
    | caller_departure          |
    | exiting normally          |
    | having its window killed  |
    | receiving a hangup signal |

# BL-372 swarm-outlives-its-launcher-02
Scenario: A launch that leaves the swarm tied to its caller fails loudly
  Given the swarm has come up still owned by the caller
  When the launcher checks what owns the swarm
  Then the launch reports failure naming the swarm as still owned by its caller
  And it does not report the swarm as ready

# BL-372 swarm-outlives-its-launcher-03
Scenario: Detaching the swarm does not weaken the readiness gate
  Given the swarm does not finish coming up
  When the launcher reports its result
  Then the launch reports failure
  And it does not report the swarm as ready
