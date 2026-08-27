Feature: The swarm's control socket lives somewhere nothing else can reap

# BL-367: on 2026-07-14 the entire /tmp/swarmforge-1000/ directory was deleted out from under a
# running tmux server. The server and all 8 agents stayed alive and working — but a unix socket
# cannot be re-linked once unlinked, and tmux has no command to rebind a running server to a new
# path. So tmux control of that swarm was UNRECOVERABLE: no capture-pane, no nudges, no stall
# detection, no dead-pane respawn, permanently, for the life of those 8 processes. The only exit was
# to kill all 8 agents and relaunch. What reaped it is NOT established and does not matter: the
# defect is the LOCATION, not the reaper. /tmp is explicitly everybody's scratch space. The swarm's
# single control channel has no business there — and the Operator's own socket, which lives under
# .swarmforge/, survived the same incident untouched.

Background:
  Given the swarm is launched with a tmux control socket

# BL-367 swarm-socket-not-in-tmp-01
Scenario: The control socket does not live in shared scratch space
  When the swarm creates its control socket
  Then the socket is not placed in a world-writable directory shared with other processes

# BL-367 swarm-socket-not-in-tmp-02
Scenario: The control socket survives a reaper cleaning shared scratch space
  Given the swarm is running
  When shared scratch space is cleaned out
  Then the swarm's control socket is untouched
  And the swarm is still controllable

# BL-367 swarm-socket-not-in-tmp-03
Scenario: The swarm launches on a host that offers no per-user runtime directory
  Given the host provides no per-user runtime directory
  When the swarm launches
  Then it still creates its control socket somewhere private to the user
  And it does not fall back to shared scratch space

# BL-367 swarm-socket-not-in-tmp-04
Scenario: A deeply-nested project still gets a usable socket
  Given the project lives at a path long enough to exceed the operating system's socket-path limit
  When the swarm launches
  Then the swarm is still controllable
  And it does not fail with an unreadable operating-system error
