Feature: BL-1967 A ceremony run records the window it folded, ending at the real instant it ran

  Split from BL-1456 (2026-10-04): the window half. A shift ends when a
  ceremony runs. The window a run folds starts where the previous run's
  window ended and ends at the instant the run happens. Today the run keys
  itself by `nowIso.slice(0, 10)`, and the night path passes
  `<date>T00:00:00Z` as the instant, so every run records a `deliveredAt`
  at a midnight that never happened. BL-1968 makes the fold use this window.

  Background:
    Given a lifecycle ledger under a fixture root
    And a previous ceremony run recorded as ending at 04:25Z on day D

  # BL-1967 the-run-records-the-window-it-folded-01
  Scenario: the run records the window it folded
    When the ceremony runs at 04:25Z on day D+1
    Then the run names a window starting at 04:25Z on day D and ending at 04:25Z on day D+1

  # BL-1967 the-night-path-hands-the-ceremony-the-real-instant-02
  Scenario: the night sleep path hands the ceremony the real instant
    Given the swarm goes to sleep through the night path at 04:25Z on day D+1
    When that path delivers the lean packet
    Then the run's window ends at 04:25Z on day D+1, not at midnight
