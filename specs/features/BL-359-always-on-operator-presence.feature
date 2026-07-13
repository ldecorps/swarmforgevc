Feature: The Operator is always there when the human wants it, and never at the swarm's expense

# BL-359: the human asked for "operator up & always on — it keeps dropping". It does, by design: the
# disposable Operator's exit protocol tears down its own window the moment it finishes its events,
# so a Remote-Control window the human is watching vanishes under him. The one persistent mode
# (attended) is an unsupervised foreground process that dies with its terminal — and while it is
# alive it holds the single Operator slot, so no tool-holding Operator can spawn and the swarm loses
# its health sweeps, dead-pane respawns and stall nudges for the whole session. So today "always on"
# and "the swarm keeps being supervised" are mutually exclusive. Both halves of that tension are
# this ticket.

Background:
  Given the swarm is running

# BL-359 always-on-operator-presence-01
Scenario: The human can reach the Operator at any moment
  When the human addresses the Operator
  Then the Operator answers him

# BL-359 always-on-operator-presence-02
Scenario: The Operator presence does not vanish when a run finishes
  Given the Operator has finished the work it was woken for
  When the human addresses the Operator
  Then the Operator answers him

# BL-359 always-on-operator-presence-03
Scenario: The Operator presence survives the terminal it was started from
  Given the Operator presence is available to the human
  When the terminal session that started it ends
  Then the human can still reach the Operator

# BL-359 always-on-operator-presence-04
Scenario: The Operator presence comes back by itself after a crash
  Given the Operator presence is available to the human
  When it dies unexpectedly
  Then it is restarted without a human intervening

# BL-359 always-on-operator-presence-05
Scenario: An always-on Operator never suspends the swarm's own recovery
  Given the Operator presence is available to the human
  When a role's pane dies and a handoff goes unattended
  Then the swarm still detects and recovers them
