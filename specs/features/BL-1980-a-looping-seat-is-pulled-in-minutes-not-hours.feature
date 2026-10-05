Feature: BL-1980 A looping local-model seat is reported stuck in minutes, not hours

  Babysitter's seat-stuck CRIT (check 5b) is what makes the coordinator pull
  a ticket a seat cannot finish, restart the seat and send it to the
  specifier (the BAU of 5b277c03cd). It fires on dwell alone: 60 minutes
  with no commit since the claim (180 until 2026-10-05). On 2026-10-04 the iq3 coder looped twice:
  on BL-1951 it re-ran thirteen git commands for ten minutes and, after a
  restart, repeated one command until qwen's loop dialog halted its turn; on
  BL-1970 it alternated two reads for six minutes until the dialog halted it
  at 22:03Z, then sat idle. QA counted 54 REPEAT notes across those sessions
  (BL-1971) and none changed the seat's course. A halted seat makes no
  further progress, and a seat collecting REPEAT notes with no commit is
  cycling, so both are stuck long before 60 minutes.

  Background:
    Given a local-model seat holding a ticket with no commit since its claim

  # BL-1980 the-loop-dialog-reports-the-seat-stuck-at-once-01
  Scenario: qwen's loop dialog on the seat's pane raises the seat-stuck CRIT at once
    Given qwen's loop-detection dialog is on that seat's pane
    When babysitter sweeps
    Then it raises the seat-stuck CRIT for that seat, naming the loop dialog

  # BL-1980 ten-repeat-notes-report-the-seat-stuck-02
  Scenario: ten REPEAT notes since the claim raise the seat-stuck CRIT
    Given the seat's current session carries 10 REPEAT notes since the claim
    When babysitter sweeps
    Then it raises the seat-stuck CRIT for that seat, naming the REPEAT count

  # BL-1980 nine-repeat-notes-do-not-03
  Scenario: nine REPEAT notes since the claim do not
    Given the seat's current session carries 9 REPEAT notes since the claim
    When babysitter sweeps
    Then it raises no seat-stuck CRIT for that seat

  # BL-1980 a-commit-after-the-notes-resets-the-count-04
  Scenario: a commit for the ticket after the REPEAT notes is progress
    Given the seat's current session carries 10 REPEAT notes since the claim
    And the seat then commits for the ticket
    When babysitter sweeps
    Then it raises no seat-stuck CRIT for that seat
