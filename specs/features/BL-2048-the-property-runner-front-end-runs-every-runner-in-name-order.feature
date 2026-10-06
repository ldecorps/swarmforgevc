Feature: BL-2048 The property-runner front-end runs every property runner in name order

  swarmforge/scripts/test holds 217 property runners (211 .bb, 4 .sh,
  2 .js, counted 2026-10-06). The suite manifest registers test_*.sh and
  *_test_runner.bb files only, and an extension vitest test names 15 of the
  .bb runners, so about 200 of them run only when someone runs one by hand
  (QA note 003876, BL-2039's QA evidence). The property-runner front-end lists
  every runner in a directory in name order, picks each one's interpreter
  from its extension, and runs them on BL-2027's recorded lane runner, so
  one command runs the population, leaves one duration row per runner and
  names every red. Which lane runs it, and over which runners, is BL-2049's
  ruling.

  # BL-2048 property-runner-front-end-01
  Scenario: the front-end runs every property runner in the directory, in name order, with its own interpreter
    Given a fixture test directory holding a .bb, a .sh and a .js property runner and one file that is not a property runner
    When the property-runner front-end runs that directory
    Then it runs exactly the three property runners
    And it runs them in name order
    And it runs the .bb runner with bb, the .sh runner with bash and the .js runner with node
    And the durations file holds one row per property runner
