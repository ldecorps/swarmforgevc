Feature: BL-1968 The closing ceremony folds every lifecycle event appended since the previous run

  Split from BL-1456 (2026-10-04): the fold half. BL-819's ledger buckets
  events by calendar day because, when it was built, no shift boundary
  existed as a computable hook; BL-820 and BL-1393 landed one - a ceremony
  run IS the shift end - but the packet still folds only events whose `at`
  date equals the run's UTC date. The night ceremony runs at about 04:25Z,
  so each packet has covered a four-hour sliver of its shift. A ledger
  event belongs to the first run after it is recorded, whatever its stamp
  says - a bounce event carries only its date, stamped at midnight. BL-1967
  records each run's window.

  Background:
    Given a lifecycle ledger under a fixture root
    And a previous ceremony run recorded as ending at 04:25Z on day D

  # BL-1968 an-event-recorded-after-the-previous-run-is-folded-01
  Scenario: an event recorded after the previous run but dated its day is folded
    Given a stage transition recorded at 21:00Z on day D
    When the ceremony runs at 04:25Z on day D+1
    Then the packet folds that stage transition

  # BL-1968 an-event-already-folded-is-not-folded-again-02
  Scenario: an event the previous run already folded is not folded again
    Given a stage transition recorded at 03:00Z on day D that the previous run folded
    When the ceremony runs at 04:25Z on day D+1
    Then the packet does not fold that stage transition

  # BL-1968 a-midnight-stamped-bounce-is-folded-by-the-next-run-03
  Scenario: a midnight-stamped bounce is folded by the first run after it is recorded
    Given a bounce recorded at 20:00Z on day D whose event is stamped 00:00Z on day D
    When the ceremony runs at 04:25Z on day D+1
    Then the packet counts that bounce in its bounce classes

  # BL-1968 the-first-run-folds-the-whole-ledger-04
  Scenario: the first run on record folds the whole ledger
    Given no previous ceremony run on record
    And stage transitions recorded on three different days
    When the ceremony runs
    Then the packet folds every one of them

  # BL-1968 an-empty-window-keeps-the-empty-outcome-05
  Scenario: a window with nothing recorded keeps the explicit empty outcome
    Given nothing recorded since the previous run
    When the ceremony runs at 04:25Z on day D+1
    Then the run carries the empty-window outcome the ceremony already defines
