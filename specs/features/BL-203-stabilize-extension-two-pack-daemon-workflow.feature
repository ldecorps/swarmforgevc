Feature: extension two-pack daemon workflow is demonstrably stable

Background:
  Given the stabilize-two-pack profile and daemon-on launch config exist
  And BL-203 is the only paused ticket (queue isolated)

# BL-203 ac-01
Scenario: daemon is up after extension launch
  When the operator launches "Run Extension (two-pack stabilize · daemon on)"
  Then handoffd reports a running/supervised state under .swarmforge/daemon/
  And all three role panes (coordinator, coder, cleaner) are live

# BL-203 ac-02
Scenario: coordinator promotes BL-203
  Given handoffd is running
  When the coordinator processes the backlog
  Then BL-203 moves from backlog/paused/ to backlog/active/

# BL-203 ac-03
Scenario: daemon routes the parcel across the swarm
  Given BL-203 is active
  When the coordinator routes work to coder
  Then coder receives the parcel via handoffd
  And cleaner receives the parcel after coder completes
  And coordinator receives completion signal from cleaner

# BL-203 ac-04
Scenario: graceful stop is clean and idempotent
  Given a running stabilize swarm
  When the operator runs ./swarm-kill
  Then all tmux sessions and handoffd processes stop
  And a second ./swarm-kill is a no-op success
  And .swarmforge/tmux-socket is cleared

# Non-behavioral gates:
#  - Smoke harness is documented and runnable without reading this ticket.
#  - No production behavior change outside the new harness + profile wiring.
