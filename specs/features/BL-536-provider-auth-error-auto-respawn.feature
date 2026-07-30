Feature: provider auth failures auto-heal

  # BL-536: classify-provider-error already maps "Invalid API key" to :auth,
  # and provider-auth-error-text?/provider-respawn-env-args already exist,
  # but nothing in handoffd/ensure observes pane scrollback for auth-class
  # failures and heals a standing role stuck idle behind one. Incident
  # 2026-07-19: an AuthenticationError left a standing role idle while
  # handoffd stayed healthy, because liveness was never the question — the
  # role's process was alive, just wedged behind a credential error.

  # BL-536 auth-error-triggers-respawn-01
  Scenario: AuthenticationError in pane triggers respawn with compat env
    Given a standing role pane whose recent scrollback matches auth-class text
    When the reliability observe tick runs
    Then the role is respawned with provider-compat env

  # BL-536 healthy-pane-not-respawned-02
  Scenario: a healthy pane with no auth-class text is left alone
    Given a standing role pane whose recent scrollback carries no auth-class text
    When the reliability observe tick runs
    Then the role is not respawned

  # BL-536 persistent-auth-failure-alerts-03
  Scenario: an auth failure that persists after respawn raises an operator-visible alert
    Given a standing role pane was just respawned for an auth-class failure
    And the role's scrollback still matches auth-class text after N respawn attempts
    When the reliability observe tick runs again
    Then an operator-visible alert is recorded
    And the role is not respawned again beyond the attempt cap
