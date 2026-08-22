Feature: A unit-lane test pins the repository it derives from

  Seven unit-lane test files take the live SwarmForge repository as their
  subject - walking its real git history, or rendering its real maintained
  diagram sources. Measured 2026-08-22 they cost 121.6s of the lane's 533.8s
  of summed work, and that cost rises with every commit landed, which is why
  no fixed per-file or whole-suite budget set on this surface has survived
  more than a few days.

  A test that needs repository history or maintained sources reads a pinned
  fixture instead. A file that genuinely must observe the live repository may
  stay, but only behind an exemption that records why: present-but-
  unjustified is the failure mode BL-999 already names one layer down.

  Duration itself is deliberately not asserted here. A scenario asserting a
  wall-clock bound flakes under this host's 3x contention swings, which is
  the disease BL-1007 exists to cure; the durations are re-measured in this
  ticket's QA end-to-end procedure instead.

  Background:
    Given the unit-lane guard that inspects test files for live-repository derivation

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-01
  Scenario: a unit-lane test that derives from the live repository is named as a violation
    Given a unit-lane test file that resolves the live repository root
    And that file carries no exemption
    When the guard runs
    Then the guard fails
    And that file is named, with what it reached for

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-02
  Scenario: a unit-lane test that derives from a pinned fixture passes
    Given a unit-lane test file that derives its history from a pinned fixture
    And that file carries no exemption
    When the guard runs
    Then the guard passes
    And that file is not named

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-03
  Scenario Outline: an exemption is honoured only when it records why
    Given a unit-lane test file that resolves the live repository root
    And that file carries an exemption whose recorded reason is <reason>
    When the guard runs
    Then the guard <verdict>

    Examples:
      | reason | verdict |
      | stated | passes  |
      | absent | fails   |

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-04
  Scenario: the guard does not flag its own machinery
    Given the guard's own source and the pinned-fixture helper both contain the pattern the guard matches on
    When the guard runs
    Then the guard passes
    And neither the guard's own source nor the fixture helper is named

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-05
  Scenario: a pinned fixture does not change when the live repository does
    Given a unit-lane test file that derives its history from a pinned fixture
    When the live repository gains a commit
    And that test runs again
    Then it reads the same fixture contents as before

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-06
  Scenario: speed is never bought with coverage
    Given the test count recorded by the previous unit-lane run
    When the unit lane runs after the conversion
    Then the recorded test count is not lower than before
    And no test file has been deleted, skipped, or added to an exclude glob
