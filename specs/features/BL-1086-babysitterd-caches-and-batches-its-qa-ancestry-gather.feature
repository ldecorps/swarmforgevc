# mutation-stamp: sha256=2362e0331ff71b34f5030966b7b21e4bc55a0acb303a322cc501b11a767c91f4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-23T03:06:37.692632272Z","feature_name":"babysitterd caches its pipeline-code-on-main gather and batches its ancestry","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1086-babysitterd-caches-and-batches-its-qa-ancestry-gather.feature","background_hash":"355ee04217280e640ddd86b5d4155100d5a4646e7bad8de940540b2e07d852a4","implementation_hash":"unknown","scenarios":[{"index":2,"name":"Any of the three tips moving forces a fresh gather","scenario_hash":"c78c48b9b87dd457235bac5f74f761e183018a2665db69164771c90bc3dec167","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-23T03:06:37.692632272Z"}]}
# acceptance-mutation-manifest-end

Feature: babysitterd caches its pipeline-code-on-main gather and batches its ancestry
  The gather re-derives the same answer every 300s tick: nothing is keyed on the
  three tips it depends on, and QA-approval is asked one shell process per SHA.
  Because babysitterd writes its freshness heartbeat only after the check
  returns, a long gather reads as a dead daemon and gets it restarted.

  The answer must not change — same offending set, same ancestry-unavailable
  posture, and `is_qa_ancestor.sh` still the one predicate that decides
  approval. Only the cost changes.

  Background:
    Given main is ahead of swarmforge-QA by 5 commits
    And one commit ahead of swarmforge-QA is not QA-approved

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-01
  Scenario: The first gather asks for approval once for the whole candidate set
    When a babysitter check runs
    Then the approval predicate is invoked once
    And the offending set names the commit that is not QA-approved

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-02
  Scenario: A tick with all three tips unchanged reuses the previous result
    Given a babysitter check has already gathered successfully
    When a babysitter check runs
    Then the approval predicate is not invoked
    And the offending set names the commit that is not QA-approved

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-03
  Scenario Outline: Any of the three tips moving forces a fresh gather
    Given a babysitter check has already gathered successfully
    And the "<ref>" tip moves
    When a babysitter check runs
    Then the approval predicate is invoked once

    Examples:
      | ref           |
      | main          |
      | origin/main   |
      | swarmforge-QA |

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-04
  Scenario: A fail-closed hole is never cached as clean
    Given the previous babysitter check reported ancestry unavailable
    When a babysitter check runs
    Then the approval predicate is invoked once

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-05
  Scenario: One unanswerable SHA fails the whole sweep closed, not partially
    Given approval cannot be answered for one commit in the candidate set
    When a babysitter check runs
    Then the check reports ancestry unavailable
    And the offending set is empty

  # BL-1086 babysitterd-caches-and-batches-its-qa-ancestry-gather-06
  Scenario: Batching does not change the answer
    When a babysitter check runs with batched ancestry
    And a babysitter check runs with per-commit ancestry
    Then both runs report the same offending set
    And both runs report the same ancestry-unavailable state
