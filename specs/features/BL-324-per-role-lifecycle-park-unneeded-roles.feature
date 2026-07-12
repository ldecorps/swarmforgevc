Feature: The swarm parks roles a ticket does not need and brings them back when it does

# BL-324: slice 3 of the dynamic-per-ticket-agent-routing epic. BL-317 records which
# roles a ticket needs and deliberately brings nothing up or down, so the manifest is
# INERT until this slice acts on it. Park = remove the role from .swarmforge/roles.tsv
# and kill its pane (the Operator's proven mechanism; absence from the roster is already
# a first-class state). Agent COUNT is the dominant cost lever.

Background:
  Given a swarm whose roster of expected-alive roles is .swarmforge/roles.tsv
  And each ticket may declare a roles: manifest naming the roles it needs

# BL-324 per-role-lifecycle-01
Scenario: A ticket's manifest shapes the swarm to exactly the roles it needs
  Given a promoted ticket whose manifest names three roles
  When the swarm is brought to that ticket's shape
  Then exactly those three roles and the warm core are alive
  And the roles the ticket does not need are parked
  And a parked role is not respawned

# BL-324 per-role-lifecycle-02
Scenario: A parked role comes back when a later ticket needs it
  Given a role that was parked because the previous ticket did not need it
  When a later ticket whose manifest names that role is promoted
  Then that role is brought back up
  And it picks up work normally

# BL-324 per-role-lifecycle-03
Scenario: A role holding an in-process parcel is never parked
  Given a role holding a claimed parcel in its in_process queue
  And a ticket whose manifest does not name that role
  When the swarm is brought to that ticket's shape
  Then that role is left alive
  And its parcel is not orphaned

# BL-324 per-role-lifecycle-04
Scenario: A role needed by the next queued ticket is not parked and re-woken
  Given a promoted ticket whose manifest does not name a role
  And the next queued ticket's manifest does need that role
  When the swarm is brought to that ticket's shape
  Then that role is left alive rather than parked and immediately restarted

# BL-324 per-role-lifecycle-05
Scenario: A ticket with no manifest keeps the full chain alive
  Given a promoted ticket that declares no roles: manifest
  When the swarm is brought to that ticket's shape
  Then every role in the full standard chain is alive
  And no role is parked

# BL-324 per-role-lifecycle-06
Scenario: A park cycle reports its measured token cost, even when it is a loss
  Given a role has been parked and later brought back up
  When the cost of that park cycle is measured against leaving the role warm and idle
  Then the measured token delta is reported
  And a delta showing the churn cost more than it saved is reported as a loss
