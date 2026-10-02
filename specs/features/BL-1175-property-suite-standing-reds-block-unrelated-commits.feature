Feature: standing property-suite reds must not block unrelated green commits

  # BL-1175: coder cannot commit feat(BL-605) — check_property_suite_drift.sh
  # refuses on ~22 pre-existing property failures (594/604 pass). SKIP override
  # is recovery-only (BL-1121). Restore a green (or explicitly allowlisted)
  # property lane so unrelated green parcels can land without the override.
  # Scenario 01 (standing-reds-listed-01: "the property suite reports
  # multiple failing files", at least 20 rows) is retired by hotfix
  # 2026-10-02 (stamp-off BL-1879): every standing red was fixed and the
  # live allowlist is empty since 1035192e8c (2026-09-18), so its premise is
  # false. The remaining scenarios run the guard from a copy with a
  # fixture-owned allowlist (the BL-1448 shape).

  Background:
    Given the property-suite drift guard runs on commits that stage extension src or property tests

  # BL-1175 green-parcel-commit-not-blocked-02
  Scenario: a green parcel that only adds its own green property tests can commit without SKIP
    Given BL-605 acceptance and its property tests are green
    And the only staged suite-triggering paths belong to that green parcel
    When the coder commits without SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD
    Then the property-suite guard does not refuse the commit for pre-existing unrelated reds

  # BL-1175 skip-remains-recovery-only-03
  Scenario: the SKIP env override remains recovery-only
    When the property-suite guard documentation and behaviour are checked
    Then SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD is not the standing recipe for green parcels
    And ordinary commits that stage extension src still run the guard

  # BL-1175 shared-repo-canary-stable-04
  Scenario: a stock property suite run does not trip the shared-repo canary
    Given a property suite run that does not intentionally mutate shared main
    When the suite completes
    Then the BL-1124 shared-repo canary does not refuse the commit
    And core.bare and live refs remain unchanged
