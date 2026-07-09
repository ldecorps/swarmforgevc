Feature: one web page shows the holistic development state

Background:
  Given a running swarm and the bridge started via its opt-in command

# BL-094 holistic-ui-01
Scenario: the bridge serves the UI
  When a browser with the bearer token opens the bridge root URL
  Then a single page renders the backlog board, per-swarm panel,
    pipeline flow, and recent activity sections

# BL-094 holistic-ui-02
Scenario: every in-flight parcel is visible with stage and swarm
  Given active tickets exist, some carrying a swarm assignment field
  When the holistic view renders
  Then each active ticket shows its assigned swarm and current pipeline
    stage
  And tickets without an assignment display as the primary swarm's

# BL-094 holistic-ui-03
Scenario: remote swarm state is git-derived and labeled
  Given an active ticket assigned to another machine's swarm
  When the holistic view renders on this machine
  Then that parcel's state reflects the latest git-synced information
  And it is visibly labeled as remote/last-synced rather than live

# BL-094 holistic-ui-04
Scenario: the view updates without reload
  Given the holistic view is open in a browser
  When a parcel advances a stage or a ticket closes into done/
  Then the page reflects the change via the SSE stream without a reload

# BL-094 holistic-ui-05
Scenario: read-only and token-gated
  When any request lacks the bearer token
  Then it is rejected
  And the UI offers no control action of any kind

# Non-behavioral gates:
#  - New projection endpoints (assignments, per-swarm, done-by-milestone)
#    unit-tested through the bridge's existing testable seams; UI is
#    presentation-only on top of them.
#  - Localhost-only binding and stateless-projection properties of BL-065
#    preserved (its suite stays green).
#  - No browser storage APIs; no external network fetches in the UI
#    bundle.
