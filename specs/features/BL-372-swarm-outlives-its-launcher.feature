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
