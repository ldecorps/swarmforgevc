Feature: a full second swarm runs under WSL2 and works the shared backlog

Background:
  Given BL-090 assignment and merge discipline are merged

# BL-091 wsl2-swarm-01
Scenario: launch without a coordinator window
  Given a swarmforge.conf naming swarm_name second with all roles except
    coordinator
  When ./swarm launches inside WSL2
  Then all configured role panes come up with live agents
  And handoffd delivers local handoffs between them normally

# BL-091 wsl2-swarm-02
Scenario: remote specifier works an assigned ticket end to end
  Given the primary coordinator has assigned an active ticket to second
  When the remote swarm's specifier syncs git and processes the ticket
  Then the parcel flows through the remote pipeline stages
  And the QA-approved merge is pushed to the shared main

# BL-091 wsl2-swarm-03
Scenario: remote swarm never touches the other swarm's parcels
  Given active tickets assigned to the primary swarm exist
  When the remote swarm operates over many sync cycles
  Then those tickets show no routing, commits, or closes from remote roles

# BL-091 wsl2-swarm-04
Scenario: bring-up doc is sufficient
  Given a WSL2 environment with only the documented prerequisites
  When the documented bring-up steps are followed
  Then the swarm launches successfully on the first attempt

# Non-behavioral gates:
#  - Any substrate incompatibility found under WSL2 is filed as its own
#    ticket with root cause, not patched inline without a test.
#  - Existing single-swarm launch behavior unchanged (suites green).
