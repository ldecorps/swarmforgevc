Feature: BL-1986 A seat whose pane shows qwen's loop dialog is reported stuck at once

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

  Split from BL-1980 on 2026-10-05 (slice 2 of 3): this feature is the loop
  dialog. BL-1985 widens the check; BL-1987 counts the REPEAT notes. The
  scenario below is BL-1980's, word for word.

  Background:
    Given a local-model seat holding a ticket with no commit since its claim

  # BL-1980 the-loop-dialog-reports-the-seat-stuck-at-once-01
  Scenario: qwen's loop dialog on the seat's pane raises the seat-stuck CRIT at once
    Given qwen's loop-detection dialog is on that seat's pane
    When babysitter sweeps
    Then it raises the seat-stuck CRIT for that seat, naming the loop dialog
