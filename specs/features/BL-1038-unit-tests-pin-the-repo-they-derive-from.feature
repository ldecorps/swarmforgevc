# mutation-stamp: sha256=da607c8c473d6c1f69d0547f29167c45fec2eaa99845d6e468b2b46e43f3f98a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T13:48:37.401740928Z","feature_name":"A unit-lane test pins the repository it derives from","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1038-unit-tests-pin-the-repo-they-derive-from.feature","background_hash":"75dab4329bd5359eb81e440ffa92d7a75fbb50882d75e6ffa4779b6c32abb373","implementation_hash":"unknown","scenarios":[{"index":2,"name":"an exemption is honoured only when it records why","scenario_hash":"aea3c6702fbb2cefb5bbb6bb4768fe9d55eb7108a6c6e7333ee465a9834e542d","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-22T13:48:37.401740928Z"}]}
# acceptance-mutation-manifest-end

Feature: A unit-lane test pins the repository it derives from

  Unit-lane test files take the live SwarmForge repository as their subject -
  walking its real git history, rendering its real maintained diagram sources,
  or copying the whole live swarmforge/scripts/ directory into a fixture. That
  cost rises with every commit landed, which is why no fixed per-file or
  whole-suite budget set on this surface has survived more than a few days.

  The family is defined by the OPERATION, not by a file list: this feature
  owns a read whose SUBJECT is the live repository, and its sibling BL-1039
  owns the CREATION of a git repository. One file may do both, and each guard
  must name only its own operation.

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

  # BL-1038 unit-tests-pin-the-repo-they-derive-from-07
  Scenario: a test that both reads live sources and builds its own repository is flagged only for the live read
    Given a unit-lane test file that resolves the live repository root
    And that same file creates a git repository of its own
    When the guard runs
    Then the guard fails
    And the guard names the live-repository read as the violation
    And the guard does not name the created git repository as a violation
