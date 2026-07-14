Feature: The Operator is always reachable, and being reachable never costs the swarm its recovery arm

# BL-359: the human asked for "operator up & always on — it keeps dropping". He resolved the design
# fork (2026-07-14) in favour of a durable CONVERSATION SURFACE, not a long-lived interactive
# session: the standing Operator topic IS the presence (BL-346), backed by disposable runs, with no
# idle token burn. What "drops" is therefore not the channel — it is the processes that own it.
# Verified on this host: nothing supervises them (the runtime and the front desk are orphaned
# `nohup` children; no systemd unit is installed anywhere), so a crash, an OOM or a reboot takes the
# surface down for good and nothing brings it back. The presence is only "always on" if it outlives
# the terminal, the crash and the reboot — and if it never quietly holds the single Operator slot
# that the swarm's health sweeps, dead-pane respawns and stall nudges need.

Background:
  Given the swarm is running

# BL-359 always-on-operator-presence-01
Scenario: The human can reach the Operator at any moment
  When the human addresses the Operator in its standing topic
  Then an answer comes back in that same topic

# BL-359 always-on-operator-presence-02
Scenario: The Operator presence does not vanish when a run finishes
  Given a disposable Operator run has finished its work and exited
  When the human addresses the Operator in its standing topic
  Then an answer comes back in that same topic

# BL-359 always-on-operator-presence-03
Scenario: The Operator presence survives the terminal it was started from
  Given the presence was started from a terminal session
  When that terminal session ends
  Then the Operator is still reachable

# BL-359 always-on-operator-presence-04
Scenario Outline: The Operator presence comes back by itself, with no human to restart it
  When the Operator presence is lost to "<mishap>"
  Then the Operator becomes reachable again without a human starting anything

  Examples:
    | mishap        |
    | a crash       |
    | a host reboot |

# BL-359 always-on-operator-presence-05
Scenario: An always-on Operator never suspends the swarm's own recovery
  Given the Operator presence is live
  When a role's pane dies and a handoff is left unattended
  Then the swarm still detects and recovers them

# BL-359 always-on-operator-presence-06
Scenario: An interactive Operator session can never go unseen by the swarm
  Given a human has started an interactive Operator session
  When the swarm decides whether an Operator is already running
  Then it sees that one is running
  And it never starts a second unrestricted Operator alongside it
