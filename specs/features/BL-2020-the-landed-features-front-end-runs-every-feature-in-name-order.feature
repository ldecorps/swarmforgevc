Feature: BL-2020 The landed-features front-end runs every feature in name order

  Nothing runs the landed feature files beyond each ticket's own: four of
  them were red for weeks before a hand run found them (BL-1626, BL-1627).
  The landed-features front-end lists every feature under a directory in
  name order and runs each through run_acceptance.sh on BL-2019's
  recorded lane runner. The real population runs in full only in the
  nightly slot after landing, never as a scenario (BL-1541).

  Moved verbatim from BL-1625 (split 2026-10-06 into BL-2019, BL-2020 and
  BL-2021 after the iq3 coder loop-halted on it).

  # BL-2020 recorded-lane-runner-02
  Scenario: the features front-end runs every feature in the directory, in name order
    Given a fixture features directory holding two one-scenario features with registered handlers
    When the landed-features front-end runs that directory to the end
    Then it runs exactly those two features
    And it runs them in name order
