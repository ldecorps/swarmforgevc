Feature: agent-memory transfer runs on hot-swap relaunch and trial boundaries

  # BL-1178 (epic BL-1176). Wire BL-1177 capture/inject into same-role model
  # switch paths — relaunch, hot-swap, trial start/end.

  Background:
    Given the portable agent-memory capture and inject API from BL-1177

  # BL-1178 hot-swap-transfers-before-live-01
  Scenario: a same-role hot-swap captures then injects before live work
    Given role "coder" is switching from one model to another via hot-swap
    When the switch proceeds
    Then memory is captured from the outgoing agent
    And memory is injected into the incoming agent before it takes live work

  # BL-1178 failed-transfer-aborts-switch-02
  Scenario: a failed memory transfer aborts the model switch
    Given inject would fail for the incoming agent
    When a same-role model switch is attempted
    Then the switch is aborted with a clear signal
    And the seat is not reported as successfully swapped

  # BL-1178 trial-start-and-end-03
  Scenario Outline: trial <boundary> transfers memory on the same role
    Given a BoB or steward trial <boundary> changes the model for one role
    When that boundary runs
    Then memory transfer runs for that role before live work resumes

    Examples:
      | boundary |
      | start    |
      | end      |
