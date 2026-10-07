Feature: A local seat forwards only a ticket whose acceptance feature passes
  The human, 2026-10-07: "Iq3 shoyld absokuyely eun the acceptence tests ad
  part of asses step, to avoid qa findong the error". The local seat's card
  already says the assert phase runs the ticket's feature, but nothing
  checks it: since 2026-10-04 most of the iq3 coder's swarm_handoff calls
  came in sessions that never ran a feature, and the phase CLI's pass
  checks only the phase. A local-model seat's git_handoff is queued only
  when the ticket's acceptance feature passes at the commit it forwards,
  and the assert step's pass runs the same check.

  Background:
    Given a local coder seat holding ticket BL-9071, whose acceptance feature has two scenarios

  # BL-2071 local-seat-forward-runs-acceptance-01
  Scenario Outline: the forward is queued only when the acceptance feature passes at the forwarded commit
    Given at the commit the seat forwards, <state>
    When the seat sends its git_handoff for BL-9071
    Then the handoff is <outcome>

    Examples:
      | state                   | outcome                              |
      | both scenarios pass     | queued                               |
      | one scenario fails      | refused, naming the failing scenario |
      | one step has no handler | refused, naming the step             |

  # BL-2071 local-seat-forward-runs-acceptance-02
  Scenario: the assert step's pass runs the same check
    Given at the seat's HEAD, one scenario fails
    When the seat runs local_seat_phase_cli.bb pass BL-9071
    Then the phase record stays at assert
    And the output names the failing scenario

  # BL-2071 local-seat-forward-runs-acceptance-03
  Scenario: a cloud coder seat's forward runs no acceptance check
    Given a cloud coder seat holding BL-9071
    When the seat sends its git_handoff for BL-9071
    Then no acceptance run is made for the send
