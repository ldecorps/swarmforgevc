Feature: BL-1991 A local seat that skips the write its compaction named is restarted on that write

  On 2026-10-05 the iq3 coder took up BL-1928, merged main, and did not
  write. One turn ran 261 model steps: 185 read_file, 63 shell commands, 6
  compactions, 0 edits. Five compaction summaries named the same next step,
  a write of specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js,
  and the model answered each one by reading more. The repeat guard's
  warnings changed nothing, and qwen's loop check is off for this seat
  (skipLoopDetection), so nothing ended the turn.

  This feature is the trial the human asked for: when the latest
  compaction names a write or an edit and the seat then makes three tool
  calls that are not that write, its qwen process is ended and a fresh one
  starts whose only user message is that next step. A seat that writes
  first is left alone, and a parcel is restarted at most twice. What
  happens on the third miss is BL-1992. No tool call is ever refused.

  Background:
    Given a local coder seat holding a parcel whose latest compaction names a write of specs/pipeline/steps/bl1928SeatToolingFromOriginMainSteps.js as its next step

  # BL-1991 three-other-calls-restart-the-seat-01
  Scenario: three tool calls that are not the named write restart the seat on that write
    Given the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the seat's qwen process is ended and a fresh one is started
    And the fresh turn's only user message is the named next step, told to write the named file and not to read a file it is about to create
    And the parcel is still in the seat's in_process

  # BL-1991 a-seat-that-writes-is-left-alone-02
  Scenario: a seat that makes the named write before its third other call is left alone
    Given the seat has made two tool calls since that compaction, neither of them the named write
    When the seat writes the named file
    Then the seat's qwen process is not restarted

  # BL-1991 two-restarts-per-parcel-03
  Scenario: a parcel is restarted at most twice
    Given the seat was already restarted twice on this parcel for a missed write
    And the seat has made two tool calls since that compaction, neither of them the named write
    When the seat makes a third tool call that is not the named write
    Then the seat's qwen process is not restarted

  # BL-1991 a-next-step-that-names-no-write-04
  Scenario: a next step that names no write or edit never restarts the seat
    Given a later compaction names "run the BL-1928 feature" as its next step
    And the seat has made two tool calls since that compaction
    When the seat makes a third tool call
    Then the seat's qwen process is not restarted
