# mutation-stamp: sha256=0ac5a46bfa28a5ec9162ef95cdd53eb8b790c70111f443bafb3c59ff13f7b6b3
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-15T15:21:28.509956Z","feature_name":"The bounce-key pair generator reaches every near-collision it claims to test","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-768-bounce-key-pair-generator-coverage.feature","background_hash":"5b11bf0bca60e13f4a9a681bc8aefecf72f949323b087e7b953730e90b966e02","implementation_hash":"unknown","scenarios":[{"index":0,"name":"each near-collision category is reached at the default run count","scenario_hash":"a0c9562bb7189802611533663c827878535bd30d491e67205424917211908e5e","mutation_count":5,"result":{"Total":5,"Killed":5,"Survived":0,"Errors":0},"tested_at":"2026-08-15T15:21:28.509956Z"}]}
# acceptance-mutation-manifest-end

Feature: The bounce-key pair generator reaches every near-collision it claims to test

  The bounce natural-key property asserts, after each run, that its generator
  reached all five near-collision categories — otherwise the property would
  pass vacuously. Reaching them is currently a matter of luck at the default
  run count, so the suite goes red at random. Coverage must come from how the
  pairs are built, not from how many are drawn.

  Background:
    Given the bounce-key pair generator

  # BL-768 bounce-key-pair-generator-coverage-01
  Scenario Outline: each near-collision category is reached at the default run count
    When 100 pairs are sampled
    Then the "<category>" category is reached

    Examples:
      | category                                 |
      | differs only in `by`                     |
      | differs only in time-of-day              |
      | differs only in producingRole/ticketType |
      | identical in every key component         |
      | differs in a key component               |

  # BL-768 bounce-key-pair-generator-coverage-02
  Scenario: coverage does not depend on a raised run count
    When 100 pairs are sampled with each of 50 different seeds
    Then every category is reached in every sample

  # BL-768 bounce-key-pair-generator-coverage-03
  Scenario: the coverage guard still names a category that is genuinely unreachable
    Given a sample in which no pair differs only in time-of-day
    When the coverage guard runs over that sample
    Then it fails naming "differs only in time-of-day"
