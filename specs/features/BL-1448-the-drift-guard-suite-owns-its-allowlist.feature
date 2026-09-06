Feature: BL-1448 The drift-guard suite decides its own allowlist, never the live one

  swarmforge/scripts/test/test_property_suite_drift_guard.sh drives the real
  check_property_suite_drift.sh, and its allowlisted-standing-red cases (11,
  12, 13, 13b, 13c, 13d, 21) name property files by hand that were rows of
  the LIVE property_suite_standing_allowlist.tsv on 2026-08-27 (BL-1175,
  BL-1234). Since BL-1428 made backlog/standing-reds.tsv authoritative and
  every owner landed, that file has drained to zero rows, so the guard
  re-runs the "allowlisted" fixture red alone, finds it still red, and
  refuses: case 11 fails. It was invisible until now because case 07
  (BL-1409's red, since 2026-08-30) stopped the suite first. A test that
  asserts against a live, draining data file is the BL-1398 / BL-1445
  shape again. This feature is that the suite's allowlist cases run the
  fixture's own copy of the guard against a fixture-owned allowlist, so the
  suite decides identically whatever the live file holds.

  # BL-1448 the-suite-passes-whatever-the-live-allowlist-holds-01
  Scenario Outline: the drift-guard suite passes every case whatever the live allowlist holds
    Given a scratch copy of the guard, its libs and the suite whose allowlist file holds <rows> data rows
    When the drift-guard suite runs against the scratch copy
    Then it passes every case

    Examples:
      | rows |
      | 0    |
      | 1    |
      | 3    |

  # BL-1448 a-live-row-for-a-fixture-red-changes-no-verdict-02
  Scenario: a live allowlist row naming one of the suite's non-allowlisted fixture files changes no verdict
    Given a scratch copy whose allowlist file gains a row for the fixture's non-allowlisted red
    When the drift-guard suite runs against the scratch copy
    Then it passes every case
