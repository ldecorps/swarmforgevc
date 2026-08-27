Feature: pilot land gate refuses vacuous declared-invariant property tests

  # BL-739: BL-718 landed cursorBridgeLive.property.test.js with
  # fc.string({ maxLength: 200 }) against splitTelegramChunks's 4096 default —
  # every run hit the early-return branch; a broken multi-chunk path stayed green.
  # BL-654 covers live architect Invariants Review; this slice hardens /pilot's
  # architect-equivalent land gate to diff new or touched *.property.test.js
  # generator bounds against the boundary constants of the function under test.
  # Companion code fix: BL-738.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-739 touched-property-triggers-reach-check-01
  Scenario: a touched property test triggers generator-reach review at pilot land
    Given the run's commits added or changed a property test file
    When the pilot runs the landing gate
    Then the gate compares that property test's generator bounds to the targeted function's boundary constants

  # BL-739 vacuous-generator-refuses-land-02
  Scenario: a generator that cannot reach the function's non-trivial branch refuses the land
    Given the run's commits touched a property test for splitTelegramChunks
    And the property generator caps string length at two hundred
    And splitTelegramChunks's default boundary is four thousand ninety-six
    When the pilot runs the landing gate
    Then the land is refused for a vacuous property generator
    And the refusal names the generator bound and the function boundary

  # BL-739 architect-review-flags-vacuity-03
  Scenario: the pilot architect-equivalent invariants review flags a vacuous property before land
    Given the pilot architect-equivalent step reviews a new property test
    And the property generator provably never reaches the non-trivial branch it claims to protect
    When the invariants review completes
    Then the review records a vacuous-property finding
    And the finding names the generator bound mismatch before any land attempt

  # BL-739 reaching-generator-passes-04
  Scenario: a property test whose generator reaches the non-trivial branch passes the reach gate
    Given the run's commits touched a property test whose generator crosses the targeted split boundary
    When the pilot runs the landing gate
    Then the generator-reach gate completes without refusal
    And other landing gates may still refuse or complete independently

  # BL-739 refused-vacuity-no-durable-05
  Scenario: a refused vacuous-property land writes nothing durable
    Given the run's commits touched a property test with a vacuous generator
    When the pilot runs the landing gate
    Then the land is refused for a vacuous property generator
    And the ticket yaml stays where it was
    And no acceptance receipt is written
