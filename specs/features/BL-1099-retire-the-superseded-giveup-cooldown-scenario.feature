Feature: One executable contract over the give-up cooldown decision, not two

  BL-303's scenario 02 reads as though it guards what a supervisor does with a
  given-up child on both sides of its cooldown. Its fixture builds that child
  with `pid: null`, and the production branch the defect lived in is guarded by
  `(and (:pid entry) ...)` - so the only interesting case, a recorded process
  that is dead, was unreachable from that scenario for a year of green runs.
  BL-1088 was the defect that hid there, and BL-1088's own feature now asserts
  the whole matrix, dead process and live process alike, against the same
  function.

  What is left in BL-303 is a scenario that no longer adds a case and still
  reads like a guarantee. Retiring it is the point of this slice: the successor's
  scenarios are the coverage, so the superseded one is removed rather than
  reworded into a third phrasing of the same assertion.

  BL-303's scenario 01 - the healthy-uptime attempt-count reset - is untouched.
  BL-1088 says nothing about it and its fixture reaches what it claims to.

  # BL-1099 retire-the-superseded-giveup-cooldown-scenario-01
  Scenario: the superseded scenario is gone from the durable contract
    Given the BL-303 feature file
    When its scenarios are listed
    Then the give-up cooldown scenario is absent
    And the healthy-uptime attempt-count reset scenario is present

  # BL-1099 retire-the-superseded-giveup-cooldown-scenario-02
  Scenario Outline: the cases the retired scenario covered are still asserted somewhere
    Given a given-up child whose cooldown <elapsed> and whose recorded process is <process state>
    When the repository's executable acceptance scenarios are searched for that case
    Then at least one scenario asserts the supervisor's decision for it

    Examples:
      | elapsed         | process state |
      | has elapsed     | dead          |
      | has elapsed     | still alive   |
      | has not elapsed | dead          |
      | has not elapsed | still alive   |

  # BL-1099 retire-the-superseded-giveup-cooldown-scenario-03
  Scenario: no step registration outlives the scenario that used it
    Given the step handlers registered for the BL-303 feature
    When the repository's feature files are searched for each registration's step text
    Then every remaining registration is referenced by at least one scenario

  # BL-1099 retire-the-superseded-giveup-cooldown-scenario-04
  Scenario: the surviving suites still run and still pass
    Given the retirement has been applied
    When the BL-303 and BL-1088 acceptance features are run
    Then both features pass with no scenario reported as missing a handler
