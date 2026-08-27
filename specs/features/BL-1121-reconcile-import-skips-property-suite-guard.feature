Feature: BL-1121 reconcile import skips the property-suite guard
  A merge that only imports already-landed extension paths (byte-identical
  to the incoming parent) must skip the full property suite without using
  SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1. Ordinary extension edits still run
  the guard.

  # BL-1121 reconcile-import-skips-01
  Scenario: byte-identical MERGE_HEAD import skips the suite
    Given a mid-merge checkout whose staged extension/src paths match the incoming parent byte-for-byte
    When the property-suite guard runs against a red injectable suite
    Then it exits 0
    And it prints skip-reconcile-import
    And it does not print property-suite-guard: run
    And it does not print overridden

  # BL-1121 ordinary-edit-still-runs-02
  Scenario: an ordinary extension/src commit still runs the suite
    Given a non-merge checkout with a staged extension/src edit
    When the property-suite guard runs against a green injectable suite
    Then it exits 0
    And it prints property-suite-guard: run
    And it does not print skip-reconcile-import

  # BL-1121 recovery-override-distinct-03
  Scenario: the env override remains recovery-only and distinct
    Given a non-merge checkout with a staged extension/src edit
    When the property-suite guard runs with SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1 against a red suite
    Then it exits 0
    And it prints overridden
    And it does not print skip-reconcile-import
