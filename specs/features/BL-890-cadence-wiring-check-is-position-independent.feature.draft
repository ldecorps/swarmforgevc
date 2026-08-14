Feature: The cadence-wiring check asserts membership, not a character offset

  # BL-890 cadence-wiring-position-independent-01
  Scenario: A sweep wired into the cadence conditional passes wherever it sits in the block
    Given a cadence conditional in handoffd.bb that invokes "dispatch-gap-sweep!"
    And a comment block of 1200 characters precedes that invocation inside the conditional
    When the cadence-wiring check runs
    Then the check passes

  # BL-890 cadence-wiring-position-independent-02
  Scenario: A sweep moved out of the cadence conditional fails the check
    Given a cadence conditional in handoffd.bb that does not invoke "dispatch-gap-sweep!"
    And "dispatch-gap-sweep!" is invoked from its own separate timer instead
    When the cadence-wiring check runs
    Then the check fails
    And its failure message names "dispatch-gap-sweep!" and the cadence conditional

  # BL-890 cadence-wiring-position-independent-03
  Scenario: The check fails loudly when it cannot find the cadence conditional at all
    Given a handoffd.bb in which the cadence conditional cannot be located
    When the cadence-wiring check runs
    Then the check fails
    And its failure message distinguishes a missing cadence conditional from an unwired sweep
