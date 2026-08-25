Feature: BL-1116 stamp-off of Cursor extension WIP hotfixes 2026-08-24
  Five human-landed hotfixes on local main carry Hotfix-Certification:
  pending (ledger keys b81334b107, 4d5375fdad, ae983877c4, d6214efe6f,
  f88913a3df). This ticket stamps that batch off — confirm or refute each
  landed behaviour, do not reimplement. A human certifies or waives via
  Approvals and the hotfix ledger; green tests alone never certify.

  # BL-1116 resident-pane-path-credentials-01
  Scenario: bridge accepts resident-pane path credentials when query strings are dropped
    Given a bridge auth request that carries credentials in the request path
    And the proxy has stripped the query string
    When bridgeAuth validates the request
    Then the path credentials are accepted as equivalent to query credentials

  # BL-1116 skip-duplicate-approval-ask-02
  Scenario: concierge does not post a second approval ask for an already-recorded live-topic ask
    Given a live ticket topic already has an approval ask recorded
    When the concierge tick considers posting another approval ask for that ticket
    Then no duplicate approval ask is posted

  # BL-1116 lets-talk-provider-routing-03
  Scenario: Let's Talk routes by provider and the bridge may run ancillary front desk
    Given a Let's Talk turn addressed to a configured ancillary provider seat
    When the bridge handles that turn
    Then the turn is routed to that provider's front-desk path
    And the bridge is allowed to run the ancillary front desk

  # BL-1116 launch-script-seat-models-04
  Scenario: non-Claude seat model labels are read from launch scripts
    Given a launch script that names a non-Claude agent model for a seat
    When the seat model display name is resolved
    Then the label comes from the launch script model, not a Claude-only default

  # BL-1116 acp-host-client-state-machine-05
  Scenario: ACP host client exposes a structured state machine for seat driving
    Given the landed ACP host client module
    When a seat-driving session advances through the machine
    Then each transition is an explicit named state
    And invalid transitions are rejected without mutating durable seat state
