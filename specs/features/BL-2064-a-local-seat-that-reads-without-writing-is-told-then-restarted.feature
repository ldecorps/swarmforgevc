Feature: A local seat that reads without writing is told to write, then restarted
  Since 2026-10-04, 61% of the iq3 coder's model time went to calls that
  only read, and 39% was reading that a compaction then discarded before
  any edit (316 of 871 read streaks ended in a compaction, not a write).
  The card already says to read only what the ticket names; the seat does
  not. The repeat guard (local_model_repeat_guard.bb), which runs after
  every tool call, counts read-type calls since the last write: at the
  12th it tells the seat its next call is a write, and at the 24th it
  restarts the seat on a fresh window the way a missed write does
  (BL-1991), drawing on the same per-parcel restart count (BL-1992).

  Background:
    Given a local seat holding a parcel with no restart used

  # BL-2064 local-seat-read-budget-01
  Scenario Outline: the read count since the last write decides the guard's answer
    Given the seat's transcript has <reads> read-type calls since its last write
    When the seat makes another read_file call
    Then the guard <answer>

    Examples:
      | reads | answer                                                             |
      | 10    | adds no read-budget note                                           |
      | 11    | tells the seat it made 12 reads without a write and to write next  |
      | 23    | restarts the seat with a first message naming its 24 reads         |

  # BL-2064 local-seat-read-budget-02
  Scenario Outline: a write, a compaction or a state-changing command starts the count again
    Given the seat's transcript has 20 read-type calls, then <reset>, then 3 read-type calls
    When the seat makes another read_file call
    Then the guard adds no read-budget note

    Examples:
      | reset                        |
      | an edit                      |
      | a write_file to tmp/notes.md |
      | a compaction                 |
      | a git commit                 |

  # BL-2064 local-seat-read-budget-03
  Scenario: a read-only shell command counts as a read
    Given the seat's transcript has 11 read-type calls since its last write
    When the seat runs the shell command sed -n 1,40p swarmforge/scripts/local_model_repeat_guard.bb
    Then the guard tells the seat it made 12 reads without a write and to write next

  # BL-2064 local-seat-read-budget-04
  Scenario: a read-budget overrun once both restarts are spent releases the parcel
    Given the parcel has already used both of its restarts
    And the seat's transcript has 23 read-type calls since its last write
    When the seat makes another read_file call
    Then the guard releases the parcel instead of restarting the seat
