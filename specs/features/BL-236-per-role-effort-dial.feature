Feature: a per-role reasoning-effort dial, suggested and manually set

  # Roadmap gap #2 (coordinator scan 2026-07-10): M5 / Spec.MD "Effort dial"
  # (~688). Beyond model choice, where a backend exposes a reasoning-effort /
  # thinking-budget setting, the extension suggests lower effort for mechanical
  # roles and higher for design-heavy ones, and lets the operator set it per
  # role. Conservative "Suggest" tier only (advisory, never silent); the Adapt
  # and Auto autonomy tiers are explicitly DEFERRED. Depends on BL-235 (the
  # per-tile respawn / in-memory launch-command control that applies the setting).
  # Paused proposal, M5 (not M1).

  Background:
    Given a running swarm where each role has a reasoning-effort setting

  # BL-236 suggest-effort-per-role-01
  Scenario: at run start the extension suggests a per-role effort with a rationale
    Given roles with differing demands, some design-heavy and some mechanical
    When the swarm starts
    Then the extension suggests a reasoning-effort per role with a one-line rationale
    And it suggests higher effort for design-heavy roles and lower for mechanical roles

  # BL-236 advisory-not-applied-02
  Scenario: a suggestion is advisory and nothing changes until the operator accepts
    Given an effort suggestion for a role
    When the operator does not accept it
    Then the role's effort is unchanged and the suggestion never applies itself

  # BL-236 manual-effort-dial-03
  Scenario: setting a role's effort via its dial respawns that role on the new effort
    Given a role whose backend exposes a reasoning-effort setting
    When the operator sets a new effort on that role's dial
    Then that role's agent is respawned with the new effort, in the in-memory config only

  # BL-236 effort-unsupported-04
  Scenario: a backend with no effort setting shows the dial as unavailable
    Given a role on a backend that exposes no reasoning-effort setting
    When the operator views that role's effort dial
    Then the dial is shown unavailable rather than sending an unsupported setting
