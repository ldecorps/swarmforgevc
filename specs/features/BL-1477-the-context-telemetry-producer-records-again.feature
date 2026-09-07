Feature: BL-1477 The context-telemetry producer records again and a torn store tail cannot silence it

  Since 2026-08-30T08:04:46Z not one context event has been recorded. The
  host's unclean shutdown before its 09:25Z boot that day left the last line
  of .swarmforge/telemetry/context-events.jsonl as 4 KB of NUL bytes with no
  newline. readPersistedContextEvents JSON-parses every line with no
  tolerance, so run-context-telemetry-producer.js throws before deriving
  anything and exits non-zero, and context-telemetry-producer-sweep! logs
  stdout only on exit zero - eight days of silence. context_telemetry_store.bb's
  read-events! throws on the same line, so the GH-23 context budget
  dashboard and BL-565's cost ledger have been dark too. The backlog behind
  it is roughly 200000 events at the store's observed rate, and the producer
  records each one through its own bb subprocess with no cap and no deadline
  - BL-1454's shape - so a naive un-darkening would overrun the 60 s
  subprocess wait bound on every cycle. This feature is that both readers
  tolerate a torn tail identically, interior damage still fails closed but
  loudly, and a tick records at most a capped batch inside its own deadline,
  the remainder following on later ticks with no duplicates.

  Background:
    Given a scratch telemetry directory and fixture transcripts for one role
    And the producer's record seam and clock are injected so recording spawns no subprocess

  # BL-1477 the-context-telemetry-producer-records-again-01
  Scenario: a store whose final line is NUL bytes is read as every whole record before it
    Given a store of 3 whole records followed by a final line of NUL bytes and no newline
    And the transcripts hold 2 events not yet in the store
    When the producer tick runs
    Then the 2 new events are recorded and the 3 whole records are not recorded again
    And the producer's output names the torn tail

  # BL-1477 the-context-telemetry-producer-records-again-02
  Scenario: the Babashka reader agrees with the producer on the same torn-tail store
    Given a store of 3 whole records followed by a final line of NUL bytes and no newline
    When context_telemetry_cli.bb summary reads that store
    Then it reports the 3 whole records and exits zero

  # BL-1477 the-context-telemetry-producer-records-again-03
  Scenario: interior damage refuses to record and says so
    Given a store with an unparseable line followed by whole records
    When the producer tick runs
    Then nothing is recorded
    And the run exits non-zero naming the damaged line number

  # BL-1477 the-context-telemetry-producer-records-again-04
  Scenario: a tick records at most its cap and later ticks carry the remainder in order
    Given the transcripts hold 50 events not yet in the store
    And the per-tick record cap is 20
    When the producer tick runs twice
    Then the first tick records exactly 20 events in timestamp order
    And the second tick records the next 20 and none is repeated

  # BL-1477 the-context-telemetry-producer-records-again-05
  Scenario: a tick stops at its deadline and leaves the rest for the next tick
    Given the transcripts hold 50 events not yet in the store
    And the clock advances 10 seconds per recorded event
    And the tick deadline is 30 seconds
    When the producer tick runs
    Then at most 3 events are recorded
    And the tick returns before the clock passes the deadline
    And the unrecorded events are recorded by later ticks in order
