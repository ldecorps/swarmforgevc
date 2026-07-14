Feature: Auto-hibernate fires when backlog is drained and coordinator is not self-generating

# BL-318: Auto-hibernate fires when backlog is drained and coordinator is not self-generating

Background:
  Given the swarm is running with auto-hibernate enabled
  And the backlog is currently drained (no active items)
  And all pipeline roles are quiescent (empty inbox/new, no in_process)

# BL-318 autopark-coordinator-self-generates-01
Scenario: Hibernation fires when backlog is drained and all roles are idle
  Given the coordinator has no self-generated tickets to promote
  And the backlog is drained and all roles are quiescent
  When the hibernation threshold is reached
  Then the swarm should hibernate

# BL-318 autopark-coordinator-self-generates-02
Scenario: Self-generated ticket carries honest provenance in source field
  Given a ticket is created by the coordinator itself
  When the ticket is written to the backlog
  Then the ticket's source field should identify the coordinator as the origin
  And the source field should not falsely claim human origin

# BL-318 autopark-coordinator-self-generates-03
Scenario: Human-raised ticket wakes hibernated swarm
  Given the swarm is hibernated due to drained backlog
  When a human-raised ticket arrives
  Then the swarm should wake and process the ticket

# BL-318 autopark-coordinator-self-generates-04
Scenario: Quiet-period gate blocks coordinator self-promotion when drained
  Given the backlog is drained and all roles are quiescent
  And the coordinator has a self-generated ticket in paused
  When evaluating promotion eligibility
  Then the self-generated ticket should not be promoted while the hibernation condition holds
