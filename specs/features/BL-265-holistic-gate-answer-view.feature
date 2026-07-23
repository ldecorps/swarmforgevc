Feature: the bridge lists the currently-pending to-human gates over HTTP

  # BL-265 slice 1 — the host read route that exposes the pending-gate list so a
  # client can SHOW gates awaiting a human answer. computeRoleGateStatesLive
  # (gateSnapshot.ts) already computes this for the Telegram narrator (BL-239) but
  # it is NOT HTTP-exposed today; this slice adds GET /gates on the bridge
  # (BL-065/BL-094). Listing pending gates is a READ (read-scoped auth); answering
  # a gate stays a control action on the existing POST /gate-answer (BL-240/241).
  # M6 capstone, gap #10. Slice 2 (the holistic-UI gate list + answer view) is
  # parked in BL-265-holistic-gate-answer-view.slice-2-ui.feature.draft.

  Background:
    Given a running swarm and the bridge started via its opt-in command

  # BL-265 gates-list-pending-01
  Scenario: a read-authenticated client lists the currently-pending gates
    Given one or more roles are blocked on a captured to-human gate
    And a client with a valid read token
    When it requests the pending-gate list
    Then the response names each currently-gated role with its question snippet
    And a role that is not gated is absent from the list

  # BL-265 gates-empty-when-none-02
  Scenario: the list is an empty result, not an error, when nothing is gated
    Given no role is blocked on a captured to-human gate
    And a client with a valid read token
    When it requests the pending-gate list
    Then the response is a successful empty list rather than an error

  # BL-265 gates-unauthenticated-refused-03
  Scenario: an unauthenticated client cannot list the gates
    Given a client without valid authentication
    When it requests the pending-gate list
    Then the request is refused

  # BL-265 gates-read-scope-suffices-04
  Scenario: a read-scoped device may list gates without the control step-up
    Given one or more roles are blocked on a captured to-human gate
    And a client authenticated as a read-scoped device
    When it requests the pending-gate list
    Then the pending-gate list is returned without requiring the control step-up
