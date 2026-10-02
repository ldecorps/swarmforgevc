Feature: BL-1641 RETIRED 2026-10-02 - its scenarios were taken out by BL-1836

  BL-1641 made a ceremony that reached its hard deadline with no briefing on
  main land the documenter's commit or, failing that, compose and commit the
  banked headless briefing. From 2026-09-23 that dump was every morning
  email, and the human ruled on 2026-09-30 that the ceremony waits for the
  documenter and never writes a briefing itself (BL-1836, ruling A).
  BL-1836 retired this feature's four scenarios: each asserted either the
  headless composer or the missing alarm after a briefing existed. Landing
  the documenter's own commit lives on in
  specs/features/BL-1836-the-closing-ceremony-waits-for-the-documenters-briefing-and-never-writes-one.feature,
  scenario 01, on any briefing tick rather than only at the deadline.
  This file is kept as a tombstone with no scenarios (Article 3.6: retire,
  never reword).
