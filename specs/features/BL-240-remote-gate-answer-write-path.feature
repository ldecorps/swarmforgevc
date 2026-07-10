Feature: answer a captured to-human gate from a remote client, scoped to gate answers only

  # Roadmap gap #4 (coordinator scan 2026-07-10); operator posture: answer captured
  # needs-human gates only — no arbitrary keystrokes or shell. Spec.MD 1356-1367:
  # an agent blocks and writes the gate to the message store; the bridge pushes it
  # to the connected remote client; answering unblocks the pipeline. Client-agnostic
  # (phone app or the BL-239 Telegram adapter both use this path). Rides the bridge
  # (BL-065). M6.

  Background:
    Given an agent blocked on a captured to-human gate in the message store

  # BL-240 answer-unblocks-01
  Scenario: answering a captured gate from an authenticated remote client unblocks the item
    Given an authenticated remote client
    When it submits an answer to that captured gate
    Then the gate is answered via the same helper-script call the extension uses locally
    And the blocked item proceeds

  # BL-240 scope-gates-only-02
  Scenario: the remote write path accepts only gate answers, not arbitrary control
    Given an authenticated remote client
    When it attempts an action other than answering a captured gate
    Then the action is refused with no arbitrary keystrokes or shell executed

  # BL-240 unauthenticated-refused-03
  Scenario: an unauthenticated client cannot answer a gate
    Given a remote client without valid authentication
    When it submits an answer to that captured gate
    Then the attempt is refused

  # BL-240 answer-targets-specific-gate-04
  Scenario: an answer applies only to the specific gate it targets
    Given two roles each blocked on a distinct captured gate
    When the remote client answers one of them
    Then only that gate is answered and the other remains blocked
