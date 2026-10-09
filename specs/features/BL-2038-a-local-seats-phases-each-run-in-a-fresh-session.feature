Feature: BL-2038 A local seat's phases each run in a fresh session

  BL-2037 gives each parcel on a local-model seat a phase record (arrange,
  act, assert) and a command that moves it. This feature wires it in:
  ready_for_next.sh, serving a local-model seat a parcel, names the
  parcel's phase and the record to read first. Ending a phase saves the
  record and then restarts the seat's session on the same parcel, the way
  the seat already restarts at each new parcel (2026-10-04), so the next
  phase starts with an empty window and the notes. Completing the parcel
  removes its record. A seat that is not a local model sees none of this.

  # BL-2038 a-served-parcel-names-its-phase-01
  Scenario Outline: serving a parcel names its phase on a local-model seat only
    Given a <agent> seat holding a parcel for BL-9001 whose phase record is in "<phase>"
    When ready_for_next.sh serves the parcel
    Then the output <phase_line>

    Examples:
      | agent       | phase   | phase_line                                              |
      | local-model | act     | names the phase "act" and the record's path             |
      | local-model | none    | names the phase "arrange" with no phase notes yet       |
      | claude      | act     | carries no phase line                                   |

  # BL-2038 ending-a-phase-restarts-the-session-02
  Scenario: ending a phase saves the record, then restarts the seat's session on the same parcel
    Given a local-model seat holding a parcel for BL-9001 whose phase record is in "arrange"
    When the seat ends the phase toward "act" with a note
    Then the record is in "act" before the seat's pane is respawned
    And the parcel for BL-9001 is still in the seat's in_process queue

  # BL-2038 completing-the-parcel-removes-its-record-03
  Scenario: completing the parcel removes its phase record
    Given a local-model seat holding a parcel for BL-9001 whose phase record is in "done"
    When the seat runs done_with_current.sh
    Then no phase record for BL-9001 remains in the seat's worktree

  # BL-2038 a-non-local-model-seat-is-never-restarted-04
  Scenario: ending a phase on a seat that is not a local model never restarts its session
    Given a claude seat holding a parcel for BL-9001 whose phase record is in "arrange"
    When the seat ends the phase toward "act" with a note
    Then no respawn-pane call was logged

  # BL-2038 a-split-request-never-restarts-05
  Scenario: a second failed assert prints a split request and never restarts the session
    Given a local-model seat holding a parcel for BL-9001 whose phase record is in "assert" with 2 failed asserts
    When the seat fails that assert with a note
    Then no respawn-pane call was logged
