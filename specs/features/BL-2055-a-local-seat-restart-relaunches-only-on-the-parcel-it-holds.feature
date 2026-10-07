Feature: BL-2055 A local seat's restart relaunches it only on the parcel it holds now

  BL-1991 restarts a local coder seat that skips the write its latest
  compaction named: the repeat guard leaves a pending override under
  .swarmforge/local-seat-restart/, keyed by the parcel's in_process
  handoff file, and ends qwen; the launch script then relaunches qwen
  with a pending override as its only message. On 2026-10-06 the iq3
  coder held BL-1913, and neither restart carried BL-1913's step. At
  23:32Z the guard wrote a restart for tmp/notes.md, but the launch script
  served the first pending override by name, an earlier parcel's BL-1963
  step, and the seat edited BL-1963's step handler. At 23:38Z it served a
  BL-1874 step the same way, and the seat replaced BL-1874's step handler.
  At 23:54Z BL-1992 released BL-1913 to another coder seat, but the
  parcel's claim-progress sidecar stayed in in_process; the guard read the
  sidecar as a new parcel with no restarts and restarted the seat on the
  ticket it had just released.

  # BL-2055 the-held-parcels-override-is-served-01
  Scenario: the launch script serves the override of the parcel in in_process, never an earlier parcel's
    Given a local coder seat whose in_process holds a parcel with a pending override
    And the restart directory also holds a pending override for an earlier parcel that is no longer in in_process, named to sort first
    When qwen exits and the launch script looks for a pending override
    Then qwen is relaunched with the override for the parcel in in_process as its only message
    And no pending override for the earlier parcel is left

  # BL-2055 an-override-whose-parcel-left-is-never-served-02
  Scenario: an override whose parcel is no longer in in_process is never served
    Given a local coder seat whose in_process holds no parcel
    And the restart directory also holds a pending override for an earlier parcel that is no longer in in_process, named to sort first
    When qwen exits and the launch script looks for a pending override
    Then qwen is not relaunched with that override
    And no pending override for the earlier parcel is left

  # BL-2055 a-released-parcels-sidecar-starts-no-restart-03
  Scenario: a seat whose parcel was released is never restarted on it
    Given a local coder seat whose in_process holds only the released parcel's claim-progress sidecar
    And the seat's latest compaction names a write of tmp/notes.md as its next step
    And the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the seat's qwen process is not restarted
    And no note is sent to the coordinator
