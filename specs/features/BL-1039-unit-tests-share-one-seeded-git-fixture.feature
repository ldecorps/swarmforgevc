# mutation-stamp: sha256=58fd741c439dd884c02fe3778f218515a2e2d90400ee042567ac4af933abfc01
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T13:39:21.949845696Z","feature_name":"A unit-lane test takes its repository from one shared seeded fixture","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1039-unit-tests-share-one-seeded-git-fixture.feature","background_hash":"305de672ad820394ed6733d26df90bbf5ad9756e854439b6ccc35b1f05931f6d","implementation_hash":"unknown","scenarios":[{"index":3,"name":"one test's writes are never visible to another","scenario_hash":"5d31afbd605efdf33dafb61368bc0ea96cb7fce5b00712bdfd8c65429879b00e","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T13:39:21.949845696Z"}]}
# acceptance-mutation-manifest-end

Feature: A unit-lane test takes its repository from one shared seeded fixture

  Unit-lane test files shell out to real `git init` and then build real
  commits, most of them once per scenario. Measured 2026-08-22 the family cost
  a large fraction of the lane's 533.8s of summed work, and several of its
  files are among the nineteen breaching BL-378's per-file 7000ms budget -
  which is why that gate cannot return green while this family exists. The
  scope is the OPERATION, not any file count: the guard's own scan over the
  test directory is the authority on which files are in it.

  One repository fixture is seeded per run and each caller gets an
  independent working copy of it. The sharing is the whole saving and also
  the whole risk: a fixture that leaks one test's commits into another's view
  trades a slow suite for a lying one, so isolation is asserted here rather
  than assumed.

  Duration itself is deliberately not asserted. A scenario carrying a
  wall-clock bound flakes under this host's 3x contention swings - the
  disease BL-1007 exists to cure - so the durations are re-measured in this
  ticket's QA end-to-end procedure instead.

  Background:
    Given the unit-lane guard that inspects test files for direct repository creation

  # BL-1039 unit-tests-share-one-seeded-git-fixture-01
  Scenario: a unit-lane test that creates its own repository is named as a violation
    Given a unit-lane test file that creates a git repository directly
    And that file carries no exemption
    When the guard runs
    Then the guard fails
    And that file is named, with the creation it performed

  # BL-1039 unit-tests-share-one-seeded-git-fixture-02
  Scenario: a unit-lane test that takes its repository from the shared fixture passes
    Given a unit-lane test file that obtains its repository from the shared seeded fixture
    And that file carries no exemption
    When the guard runs
    Then the guard passes
    And that file is not named

  # BL-1039 unit-tests-share-one-seeded-git-fixture-03
  Scenario: the guard does not flag its own machinery
    Given the shared fixture helper creates a git repository, as it must
    When the guard runs
    Then the guard passes
    And the fixture helper is not named

  # BL-1039 unit-tests-share-one-seeded-git-fixture-04
  Scenario Outline: one test's writes are never visible to another
    Given two unit-lane tests that each obtain a repository from the shared seeded fixture
    And the first test commits a change to its own copy
    When the two tests run in <order>
    Then the second test observes the seeded history only
    And it does not observe the first test's commit

    Examples:
      | order            |
      | declaration      |
      | reverse          |

  # BL-1039 unit-tests-share-one-seeded-git-fixture-05
  Scenario: the seeding cost is paid once per run
    Given several unit-lane test files that each obtain a repository from the shared seeded fixture
    When the unit lane runs
    Then the fixture is seeded exactly once
    And each calling file still receives its own working copy

  # BL-1039 unit-tests-share-one-seeded-git-fixture-06
  Scenario: speed is never bought with coverage
    Given the test count recorded by the previous unit-lane run
    When the unit lane runs
    Then the recorded test count is not lower than before
    And no test file has been deleted, skipped, or added to an exclude glob

  # BL-1039 unit-tests-share-one-seeded-git-fixture-07
  Scenario: the guard is armed over the whole unit lane, not just a sample
    Given the whole unit-lane test directory as the guard's subject
    When the guard scans it
    Then no unexempted file is named
    And every exempted file records the repository shape it needs
