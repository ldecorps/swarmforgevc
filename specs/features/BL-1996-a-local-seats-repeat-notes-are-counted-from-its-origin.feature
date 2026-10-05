Feature: BL-1996 A local seat's REPEAT notes are counted from its progress origin, never from text it read

  Check 5b raises the seat-stuck CRIT at ten REPEAT notes since a seat's
  claim (BL-1985). This feature is the count itself, over a seat's qwen
  session file. A REPEAT note is the line the repeat guard appends to a
  tool result: "REPEAT: you have now made this exact <tool> call <N>
  times". A tool result that only quotes the phrase - the seat read the
  guard's source, a ticket, or a session file - is not a note. On
  2026-10-05 the iq3 coder's BL-1987 session held 13 notes after its claim
  and 20 tool results containing the phrase.

  Split from BL-1987 on 2026-10-05 (slice 1 of 2); BL-1997 wires the count
  into check 5b.

  # BL-1996 notes-at-or-after-the-origin-are-counted-01
  Scenario: only REPEAT notes stamped at or after the origin are counted
    Given a qwen session with 3 REPEAT notes stamped before the origin and 10 stamped at or after it
    When the REPEAT notes since the origin are counted
    Then the count is 10

  # BL-1996 a-quoted-phrase-is-not-a-note-02
  Scenario: a tool result that only quotes the REPEAT phrase is not a note
    Given a qwen session with 2 REPEAT notes after the origin and 4 tool results after it that quote the phrase inside the text they read
    When the REPEAT notes since the origin are counted
    Then the count is 2

  # BL-1996 a-worktree-with-no-session-counts-zero-03
  Scenario: a worktree with no qwen session counts zero
    Given a worktree with no qwen session directory
    When the REPEAT notes in its current session are counted
    Then the count is 0
