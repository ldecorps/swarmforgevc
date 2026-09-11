Feature: BL-1528 An undeliverable closing-ceremony note is a failed run

  runClosingCeremony writes the shift's run record and then sends the
  packet note through swarm_handoff.sh. When that send is refused (the
  recipient is absent from the roster, the tmux inject fails, any non-zero
  exit) the record already exists as pending, the exception skips the night
  sequence's state write, and the next sweep finds the run, sends nothing,
  and advances as if the packet had been delivered. The failure is only
  noticed at the next ceremony, and its failure note goes to the same
  absent role. This feature is that a refused send is a failed run at
  write time, with the refusal on the record and on the ceremony's own
  loud surface, and that the night sequence still advances.

  Background:
    Given a target project whose lifecycle ledger holds one non-empty shift
    And the night closing ceremony has reached its lean-packet step

  # BL-1528 undeliverable-lean-packet-01
  Scenario: a refused packet send stores the run as failed with the refusal text
    Given the roster has no row for the packet note's recipient
    When the lean-packet step runs
    Then the stored ceremony run for that shift is failed
    And the stored run carries the delivery failure text naming the unknown recipient
    And no handoff citing the packet exists in any inbox

  # BL-1528 undeliverable-lean-packet-02
  Scenario: a refused packet send is surfaced on the ceremony's loud log the same run
    Given the roster has no row for the packet note's recipient
    When the lean-packet step runs
    Then the closing-ceremony loud log ends with closing-lean-packet-undeliverable naming the shift
    And the night state's loudSurfaces names closing-lean-packet-undeliverable

  # BL-1528 undeliverable-lean-packet-03
  Scenario: a refused packet send does not wedge the night sequence
    Given the roster has no row for the packet note's recipient
    When the lean-packet step runs
    Then the step completes without an error exit
    And the written night state lists lean-packet as done
    When the lean-packet step runs a second time
    Then no second loud line is appended
    And no handoff citing the packet exists in any inbox

  # BL-1528 undeliverable-lean-packet-04
  Scenario: a refused failure note for a stale pending run is surfaced, not thrown
    Given a pending ceremony run from an earlier shift
    And the roster has no row for the failure note's recipient
    When the lean-packet step runs
    Then the earlier run is finalized as failed
    And the closing-ceremony loud log contains closing-ceremony-failure-undeliverable naming the earlier shift
    And the step completes without an error exit

  # BL-1528 undeliverable-lean-packet-05
  Scenario: a delivered packet send is unchanged
    Given the roster has a row for the packet note's recipient
    When the lean-packet step runs
    Then the stored ceremony run for that shift is pending
    And one handoff citing the packet is queued for the recipient
    And the closing-ceremony loud log gains no line
