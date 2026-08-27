Feature: deterministic turn profiler classifies transcript intervals into a trended series

  # BL-664: Read-only walker over role transcripts classifies each tool-call
  # interval — git-mechanical, test-run, file-read, thinking-writing, turn-overhead,
  # provider-outage retry windows — and emits turnProfile (TrendedNumber) per stage.
  # Sizes BL-667 transit assists; shared substrate for BL-665 context telemetry and
  # BL-666 burn meter. Profile FIRST — retroactive on weeks of history. BL-635 honesty:
  # state coverage window; never extrapolate absent data.

  Background:
    Given fixture role transcripts and handoff trail records for profiling

  # BL-664 classify-intervals-01
  Scenario Outline: the walker classifies each tool-call interval into the turn taxonomy
    Given a transcript interval that is <interval kind>
    When the deterministic transcript walker profiles that interval
    Then the interval is classified as <category>

    Examples:
      | interval kind              | category          |
      | a trivial git fast-forward | git-mechanical    |
      | a test or mutation run     | test-run          |
      | reading backlog or specs   | file-read         |
      | drafting or editing prose  | thinking-writing  |
      | boot before first action   | turn-overhead     |
      | a provider retry storm     | provider-outage   |

  # BL-664 read-only-transcripts-02
  Scenario: the profiler never writes moves or truncates transcript files
    Given role transcripts on disk before profiling
    When the deterministic transcript walker runs over those transcripts
    Then every transcript file bytes and path remain unchanged

  # BL-664 coverage-window-honest-03
  Scenario: absent transcript data renders absent with an explicit coverage window
    Given transcripts cover only a bounded time window
    When the walker profiles available history
    Then the output states the coverage window
    And it does not extrapolate shares outside that window

  # BL-664 turn-profile-series-04
  Scenario: profiling emits turnProfile mechanical and turn-overhead shares per stage
    Given classified intervals across multiple pipeline stages
    When the walker aggregates a turnProfile series
    Then each stage entry carries mechanical share and turn-overhead share
    And the series uses the TrendedNumber shape for briefing and trend surfaces

  # BL-664 handoff-attribution-05
  Scenario: each turn is attributed to stage and ticket via the handoff trail
    Given transcript activity during an active ticket parcel
    When the walker profiles that window
    Then each classified turn names its pipeline stage
    And names the ticket id from the handoff trail when one is active

  # BL-664 retroactive-history-06
  Scenario: profiling runs retroactively on transcripts that predate the walker
    Given role transcripts written days before the profiler existed
    When the deterministic transcript walker runs for the first time
    Then those historical transcripts contribute classified intervals to turnProfile
    And no transcript is required to be replayed through a live agent
