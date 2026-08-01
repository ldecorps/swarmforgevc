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
