Feature: The closing ceremony folds every lifecycle event since the previous run

  BL-819's ledger buckets events by calendar day because, when it was built,
  no shift boundary existed as a computable hook; its own header says that
  re-bucketing to a real boundary is "a mechanical follow-up" once BL-820
  lands one. BL-820 and BL-1393 landed it - a ceremony run IS the shift end,
  and every run is recorded - but the packet still folds only events whose
  `at` date equals the run's UTC date. The night ceremony runs at about
  04:25Z, so each packet has covered a four-hour sliver of its shift and
  everything between the previous run and midnight has reached no packet.

  A shift ends when a ceremony runs. The window a run folds starts where the
  previous run's window ended and ends at the instant the run happens. A
  ledger event belongs to the first run after it is recorded, whatever its
  stamp says - a bounce event carries only its date, stamped at midnight.

  Background:
    Given a lifecycle ledger under a fixture root
    And a previous ceremony run recorded as ending at 04:25Z on day D

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-01
  Scenario: an event recorded after the previous run but dated its day is folded
    Given a stage transition recorded at 21:00Z on day D
    When the ceremony runs at 04:25Z on day D+1
    Then the packet folds that stage transition

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-02
  Scenario: an event the previous run already folded is not folded again
    Given a stage transition recorded at 03:00Z on day D that the previous run folded
    When the ceremony runs at 04:25Z on day D+1
    Then the packet does not fold that stage transition

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-03
  Scenario: a midnight-stamped bounce is folded by the first run after it is recorded
    Given a bounce recorded at 20:00Z on day D whose event is stamped 00:00Z on day D
    When the ceremony runs at 04:25Z on day D+1
    Then the packet counts that bounce in its bounce classes

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-04
  Scenario: the run records the window it folded
    When the ceremony runs at 04:25Z on day D+1
    Then the run names a window starting at 04:25Z on day D and ending at 04:25Z on day D+1

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-05
  Scenario: the first run on record folds the whole ledger
    Given no previous ceremony run on record
    And stage transitions recorded on three different days
    When the ceremony runs
    Then the packet folds every one of them

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-06
  Scenario: a window with nothing recorded keeps the explicit empty outcome
    Given nothing recorded since the previous run
    When the ceremony runs at 04:25Z on day D+1
    Then the run carries the empty-window outcome the ceremony already defines

  # BL-1456 the-ceremony-folds-every-event-since-the-previous-run-07
  Scenario: the night sleep path hands the ceremony the real instant
    Given the swarm goes to sleep through the night path at 04:25Z on day D+1
    When that path delivers the lean packet
    Then the run's window ends at 04:25Z on day D+1, not at midnight
