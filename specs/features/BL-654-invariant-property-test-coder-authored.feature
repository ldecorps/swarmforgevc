Feature: declared invariants get coder-authored executable property tests

  BL-633 taught the specifier to STATE invariants and the architect to review
  them, but nobody told the coder — grep for invariant in the coder role
  prompt scored zero — so the first executable check of a declared property
  happened in the architect's review sweep, making the reviewer the de-facto
  first author (BL-590 P5/P6; BL-635 send-back #1 on a declared invariant the
  coder never encoded). This slice completes the chain state -> encode ->
  verify -> stress: the specifier states the property, the coder ENCODES it
  as an executable property test whose generator demonstrably reaches the
  states the invariant quantifies over, the architect verifies existence and
  non-vacuity FIRST — never first-authoring — and a missing encoding is
  recorded distinguishably from a violated property.

  # BL-654 invariant-property-test-01
  Scenario: the coder prompt makes each declared invariant a coder-authored property test
    Given the coder role prompt
    Then it instructs encoding each declared ticket invariant as a coder-authored executable property test in the same parcel
    And it instructs recording a stated reason in the parcel when an invariant admits no executable encoding
    And the word invariant now appears in the coder role prompt

  # BL-654 invariant-property-test-02
  Scenario: the coder prompt names the generator-reach requirement as part of the contract
    Given the coder role prompt
    Then it states the generator must demonstrably reach the states the invariant quantifies over
    And it names an asserted reachability floor rather than a hoped-for one
    And it names weighting progress operations and constructing colliding pairs as the known failure shapes

  # BL-654 invariant-property-test-03
  Scenario: the coder prompt exclusion no longer bars declared-invariant property tests
    Given the coder role prompt
    Then its does-not-own exclusion leaves declared-invariant property tests with the coder
    And it leaves the broader property-coverage pass with the architect

  # BL-654 invariant-property-test-04
  Scenario: the architect prompt puts existence and non-vacuity before hand-verification
    Given the architect role prompt
    Then it instructs first checking each declared invariant for an executable property test or a stated non-encodability reason
    And it states a missing or vacuous property test is a send-back naming the missing test before any hand-verification of the property
    And it states the architect is never the first author of a declared invariant's property test

  # BL-654 invariant-property-test-05
  Scenario: a missing-encoding send-back is recorded distinguishably from a violated property
    Given the architect role prompt
    Then it instructs recording a missing-property-test send-back like any other send-back
    And it names the failure class invariant-unencoded to distinguish property never encoded from property violated

  # BL-654 invariant-property-test-06
  Scenario: a ticket without invariants creates no new obligation
    Given the coder role prompt
    And the architect role prompt
    Then both state that a ticket with no declared invariants creates no property-test obligation

  # BL-654 invariant-property-test-07
  Scenario: the worked example encodes BL-635 pre-epoch rendering and asserts its reach
    Given the pre-epoch worked example fixture and its coder-authored property test
    When the property test runs against the correct implementation
    Then the property test passes
    And it asserts the generated runs reached a pre-epoch window at least its declared floor of times

  # BL-654 invariant-property-test-08
  Scenario: the worked example fails against the defect the review had to catch by hand
    Given the pre-epoch worked example fixture and its coder-authored property test
    When the property test runs against the defective variant that fabricates zero for a pre-epoch period
    Then the property test fails naming the pre-epoch invariant

  # BL-654 invariant-property-test-09
  Scenario: an assertion-deleted variant of the property test is exposed by the expected-failure check
    Given a vacuous variant of the worked example property test with its assertion removed
    When the vacuous variant runs against the defective variant
    Then the vacuous variant stays green
    And the non-vacuity check flags it because the expected failure did not occur

  # BL-654 invariant-property-test-10
  Scenario: a shallow-generator variant fails its own reachability floor
    Given a shallow variant of the worked example property test whose generator never reaches a pre-epoch window
    When the shallow variant runs against the correct implementation
    Then its reachability assertion fails even though the invariant assertion never fired
