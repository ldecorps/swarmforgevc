Feature: A Cursor-driven seat holds a real role in the pipeline
  A seat driven over a structured agent session takes a parcel from its own
  mailbox, does the stage work, and forwards a handoff — using the same helpers
  every other agent uses, and deciding only on structured session signals.
  Source: human via Cursor 2026-07-30; BL-713 (slice A of BL-712).

  Background:
    Given a role seat driven by the Cursor seat driver over a stubbed agent session

  # BL-713 cursor-seat-01
  Scenario: the seat boots with its own role identity
    When the seat is started for a role
    Then the driver opens an agent session carrying that role's prompt bundle
    And the session is bound to that role's own worktree

  # BL-713 cursor-seat-02
  Scenario: a wake makes the seat ask for its next task
    Given a parcel is waiting in that role's mailbox
    When the seat receives a wake
    Then the driver runs the ready-for-next helper
    And the parcel it returns is given to the session as the task

  # BL-713 cursor-seat-03
  Scenario: the seat forwards through the handoff helper
    Given the session reports the stage work finished
    When the driver forwards the parcel
    Then it sends the handoff through the handoff helper
    And it writes nothing directly into another role's inbox

  # BL-713 cursor-seat-04
  Scenario Outline: the driver decides on structured signals only
    When the session reports <signal>
    Then the driver takes its next step from that reported signal
    And the driver reads no rendered pane text to make that decision

    Examples:
      | signal              |
      | a stop reason       |
      | a tool event        |
      | a helper exit status |

  # BL-713 cursor-seat-05
  Scenario: an empty mailbox does not spin
    Given that role's mailbox is empty
    When the seat receives a wake
    Then the driver reports no task available
    And it does not poll the mailbox again on its own

  # BL-713 cursor-seat-06
  Scenario: a production pack refuses an uncertified identity
    Given no spike-only escape is set
    And the Cursor identity is not certified in the model steward registry
    When the seat is started for a production pack
    Then the driver refuses to start
    And it names certification as the reason

  # BL-713 cursor-seat-07
  Scenario: the human can see what the seat did
    When the seat completes a parcel
    Then the session transcript is available to the human
