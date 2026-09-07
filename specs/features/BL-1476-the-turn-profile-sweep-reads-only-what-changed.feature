Feature: BL-1476 The turn-profile producer sweep reads only what changed

  BL-1364 wired turn-profile-producer-sweep! into handoffd. Every daemon
  cycle it shells to run-turn-profile-producer.js, which lists every .jsonl
  transcript ever written under each role's ~/.claude/projects slug and reads
  and JSON-parses all of them twice - once to assess readability, once to
  walk - before deciding whether today's row changed. Nothing it records
  feeds back into what it reads. On 2026-09-07 that is 2.2 GB across 8 role
  groups and 27-39 s of every ~60 s daemon cycle, growing with every session
  ever started, in the same sequential loop and against the same
  SUPERVISOR_IN_SWEEP_BUDGET_MS that BL-1454's sweep overran, and 21 s short
  of the 60 s subprocess wait bound that would kill it unlogged. This feature
  is that a tick reads only transcripts changed since the last completed
  tick, records exactly what a full walk would record, reports how many
  transcripts it read of how many it listed, and stops at its own deadline
  leaving the rest for the next tick.

  Background:
    Given a scratch claude-projects directory holding fixture transcripts for two role worktrees
    And the producer's clock and content-read seam are injected so every transcript opened for content is observable

  # BL-1476 the-turn-profile-sweep-reads-only-what-changed-01
  Scenario: a tick after nothing changed reads no transcript and writes the same row
    Given a completed tick has summarised 40 transcripts and written the day's row
    When a tick runs with no transcript changed
    Then no transcript is opened for content
    And the tick reports reading 0 of 40 transcripts
    And the day's row is written again unchanged

  # BL-1476 the-turn-profile-sweep-reads-only-what-changed-02
  Scenario Outline: only the changed transcripts are read and the row equals a full walk
    Given a completed tick has summarised 40 transcripts and written the day's row
    And since then one transcript <change>
    When a tick runs
    Then the tick reports reading <read> of <listed> transcripts
    And no transcript other than the changed one is opened for content
    And the day's row equals the row a full walk of the current transcripts produces

    Examples:
      | change                 | read | listed |
      | grew by appended lines | 1    | 40     |
      | was created            | 1    | 41     |
      | was deleted            | 0    | 39     |

  # BL-1476 the-turn-profile-sweep-reads-only-what-changed-03
  Scenario: a tick that reaches its deadline writes no row and the next tick finishes the walk
    Given 40 transcripts none of which has a summary
    And the clock advances 10 seconds per transcript read
    And the tick deadline is 30 seconds
    When a tick runs
    Then at most 3 transcripts are opened for content
    And no row is written
    And the tick reports a partial walk
    And the summaries of the transcripts it completed are persisted
    And a following tick with an unlimited deadline opens only the transcripts without a summary
    And that tick's row equals the row a full walk of all 40 transcripts produces
