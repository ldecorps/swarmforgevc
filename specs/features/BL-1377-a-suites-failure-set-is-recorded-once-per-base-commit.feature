# mutation-stamp: sha256=0bfe03bd0a1d45b864bbc46f327b5777a55f2e17fa9a513daf135f102d4e5302
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-03T13:27:54.408490061Z","feature_name":"BL-1377 A suite's failure set is recorded once per base commit","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1377-a-suites-failure-set-is-recorded-once-per-base-commit.feature","background_hash":"9a300b1900a1382ee29c3714d9f008e799ac677db0ea20c6b541ddb1a7ae4232","implementation_hash":"unknown","scenarios":[{"index":1,"name":"any difference from the recorded set is named and forces the second run","scenario_hash":"3b2bdd190082b6358dec1e28f08f8167d6b7af0c50ca15e64f73d31e028a0baf","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-03T13:27:54.408490061Z"},{"index":2,"name":"every way of not having a usable record falls back to today's two runs","scenario_hash":"80df7cef3c710fa31337ff87436c11744f849957c7c0dad4fae4524086a7aa0c","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-09-03T13:27:54.408490061Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1377 A suite's failure set is recorded once per base commit

  A stage must show that a red was already red before its parcel, and today it
  shows that by running the suite twice - once at the base, once with the
  parcel. The base half of that answer is the same for every stage at the same
  base commit. This feature records it once, keyed by suite, base sha and the
  suite's own config hash, so a stage with a fresh record runs the suite once
  and diffs. The cache may shrink a run; it may never widen an excuse, and
  every way of not having a usable record falls back to running both.

  Background:
    Given the stage's parcel sits on base sha "abc1230000"

  # BL-1377 fresh-baseline-runs-the-suite-once-01
  Scenario: a stage with a fresh baseline for its base runs the suite once
    Given a recorded baseline for suite "unit" at that base sha with 2 reds
    And the suite config hash matches the record
    When the stage gathers its pre-existing-red evidence
    Then the suite is run once
    And the evidence names that base sha, 2 recorded reds and 2 observed reds

  # BL-1377 a-mismatch-forces-the-second-run-02
  Scenario Outline: any difference from the recorded set is named and forces the second run
    Given a recorded baseline for suite "unit" at that base sha with 2 reds
    And the observed run has <observed>
    When the stage gathers its pre-existing-red evidence
    Then the suite is run twice
    And the evidence names the <difference> test

    Examples:
      | observed                        | difference |
      | a red the record does not name  | new        |
      | lost a red the record names     | vanished   |

  # BL-1377 an-unusable-record-falls-back-to-both-runs-03
  Scenario Outline: every way of not having a usable record falls back to today's two runs
    Given the baseline record is <record>
    When the stage gathers its pre-existing-red evidence
    Then the suite is run twice
    And no red is excused by a recorded baseline

    Examples:
      | record                                       |
      | absent                                       |
      | unreadable                                   |
      | recorded under a different suite config hash |
      | recorded at a different base sha             |

  # BL-1377 a-cached-baseline-never-excuses-an-unnamed-red-04
  Scenario: a red the record does not name is never reported as pre-existing
    Given a recorded baseline for suite "unit" at that base sha with 2 reds
    And the observed run has a red the record does not name
    When the stage gathers its pre-existing-red evidence
    Then the evidence reports the unnamed red as new
    And the evidence does not report the unnamed red as pre-existing

  # BL-1377 the-first-stage-at-a-base-records-it-05
  Scenario: the first stage to run a suite at a base commit records its failure set
    Given no baseline record exists for suite "unit" at that base sha
    When the stage gathers its pre-existing-red evidence
    Then the observed failure set is written as the new baseline for suite "unit"
    And the written record carries the base sha and suite config hash it was observed under

  # BL-1377 the-standing-allowlist-still-applies-06
  Scenario: the standing allowlist keeps applying alongside the cache
    Given a recorded baseline for suite "unit" at that base sha with 2 reds
    And an allowlisted known-benign error occurs during the run
    When the stage gathers its pre-existing-red evidence
    Then the allowlisted error is still tolerated
    And the recorded baseline is unchanged by it
