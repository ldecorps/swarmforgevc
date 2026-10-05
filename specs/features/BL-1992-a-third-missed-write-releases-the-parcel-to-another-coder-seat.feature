Feature: BL-1992 A third missed write releases the parcel to another coder seat

  BL-1991 restarts a local seat at most twice per parcel when it skips the
  write its latest compaction named. The human's trial goes on: "On the
  third miss, do not restart: the parcel must leave `in_process`, and a
  note must name the ticket so the other coder seat can take it." This
  feature is that third miss. A seat that writes on its last chance keeps
  its parcel.

  Background:
    Given a local coder seat already restarted twice on its parcel for a missed write, whose latest compaction names a write of specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js as its next step

  # BL-1992 the-third-miss-releases-the-parcel-01
  Scenario: the third missed write releases the parcel and names the ticket to the coordinator
    Given the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the parcel is no longer in the seat's in_process
    And the coordinator receives a note naming the parcel's ticket, so another coder seat can take it
    And the seat's qwen process is not restarted

  # BL-1992 a-write-on-the-last-chance-keeps-the-parcel-02
  Scenario: a seat that writes on its last chance keeps its parcel
    Given the seat has made two tool calls since that compaction, neither of them the named write
    When the seat writes the named file
    Then the parcel is still in the seat's in_process
    And the coordinator receives no note about the parcel
