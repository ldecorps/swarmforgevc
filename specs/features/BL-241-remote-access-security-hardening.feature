Feature: harden remote access — token rotation, device revocation, and read-vs-control scope

  # Roadmap gap #5 (coordinator scan 2026-07-10). Spec.MD 1426: the remote tunnel
  # needs a real threat model — token rotation, revoking a lost device, scope of
  # what a remote client can do (read-only vs control), and a stronger auth step for
  # control actions than for viewing. BL-065's bridge today has one static bearer
  # token with no rotation/revocation/scoping. Sequenced AFTER BL-240 (there is no
  # control surface to harden until the gate-answer write path exists). M6, medium.

  Background:
    Given the remote bridge with token-based auth and one or more authorized devices

  # BL-241 token-rotation-01
  Scenario: rotating an access token invalidates the old one
    Given a remote client authenticated with a token
    When the token is rotated
    Then the old token no longer authenticates and the new token does

  # BL-241 device-revocation-02
  Scenario: revoking a lost device does not affect the others
    Given multiple authorized devices
    When one device is revoked
    Then it can no longer connect and the other devices are unaffected

  # BL-241 read-only-cannot-control-03
  Scenario: a read-only-scoped client cannot perform control actions
    Given a remote client scoped to read-only
    When it attempts a control action such as answering a gate
    Then the action is refused

  # BL-241 control-requires-step-up-04
  Scenario: control actions require a stronger auth step than viewing
    Given a remote client authorized for control
    When it performs a control action
    Then it must pass a stronger auth step than read-only viewing requires
