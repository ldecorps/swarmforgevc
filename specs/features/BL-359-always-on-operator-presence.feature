# mutation-stamp: sha256=dbc958772f384cf59796309e7e5ff165cfcd47974016c2aae8457d4f28676238
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-10T14:45:17.417480700Z","feature_name":"The Operator is always reachable, and being reachable never costs the swarm its recovery arm","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-359-always-on-operator-presence.feature","background_hash":"9ef835017808abfb6f23bbc0e2fd0f8300500d574f54f6f8da9183f625322630","implementation_hash":"unknown","scenarios":[{"index":3,"name":"The Operator presence comes back by itself, with no human to restart it","scenario_hash":"7f6e1f507045e1fb4f93431adb1d4eb5e5dd877d53e6b5576cee946db080656c","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-10T14:45:17.417480700Z"}]}
# acceptance-mutation-manifest-end

Feature: The Operator is always reachable, and being reachable never costs the swarm its recovery arm

# BL-359: the human asked for "operator up & always on — it keeps dropping". He resolved the design
# fork (2026-07-14) in favour of a durable CONVERSATION SURFACE, not a long-lived interactive
# session: the standing Operator topic IS the presence (BL-346), backed by disposable runs, with no
# idle token burn. What "drops" is therefore not the channel — it is the processes that own it.
# Verified on this host: nothing supervises them (the runtime and the front desk are orphaned
# `nohup` children; no systemd unit is installed anywhere), so a crash, an OOM or a reboot takes the
# surface down for good and nothing brings it back. The presence is only "always on" if it outlives
# the terminal, the crash and the reboot — and if it never quietly holds the single Operator slot
# that the swarm's own liveness owner, the deterministic babysitter (health sweeps, dead-pane
# respawns and stall nudges), needs.

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

# RETIRE-WITH: BL-1514

# BL-359 always-on-operator-presence-06
Scenario: An interactive Operator session can never go unseen by the swarm
  Given a human has started an interactive Operator session
  When the swarm decides whether an Operator is already running
  Then it sees that one is running
  And it never starts a second unrestricted Operator alongside it
