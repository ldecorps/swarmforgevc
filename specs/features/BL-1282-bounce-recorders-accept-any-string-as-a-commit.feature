Feature: A bounce record cites a real commit

  The bounce recorders validate every argument they take against a real
  contract except the one that carries the evidence. Article 2.2 already
  states that contract - a commit is exactly ten hex characters naming one
  real commit - and these scenarios enforce it at the write path, so a
  record can always be walked back to the diff it blames.

  The commit cases below are symbolic: each names one shape the live store
  was found holding on 2026-08-30 - a nine-character hash, a full
  forty-character hash, a non-hex word, and a well-formed hash that resolves
  to no object. The concrete values sit in the step handler's known values,
  not in the contract.

  Background:
    Given a scratch project root with an empty bounce store
    And a repository containing a commit whose ten-hex prefix is known

  # BL-1282 bounce-commit-is-a-real-commit-01
  Scenario Outline: a commit the store cannot stand behind is refused
    Given a bounce recorder invocation for the "<commit>" case
    When the recorder runs
    Then it refuses with reason "<reason>"
    And the bounce store is unchanged

    Examples:
      | commit       | reason              |
      | short-hash   | commit-not-ten-hex  |
      | full-hash    | commit-not-ten-hex  |
      | non-hex-word | commit-not-ten-hex  |
      | unresolvable | commit-unresolvable |

  # BL-1282 bounce-commit-is-a-real-commit-02
  Scenario: a ten-hex commit that exists is recorded unchanged
    Given a bounce recorder invocation for the "known-existing" case
    When the recorder runs
    Then the bounce store gains exactly one record citing that commit
    And the recorder reports the outcome as "written"

  # BL-1282 bounce-commit-is-a-real-commit-03
  Scenario Outline: the caller can always tell which outcome happened
    Given a bounce store already holding a record for the known ten-hex prefix
    And a bounce recorder invocation for the "<commit>" case
    When the recorder runs
    Then the recorder reports the outcome as "<outcome>"

    Examples:
      | commit         | outcome         |
      | known-existing | duplicate-no-op |
      | other-existing | written         |
      | non-hex-word   | refused         |

  # BL-1282 bounce-commit-is-a-real-commit-04
  Scenario: the correction recorder holds the same contract
    Given a bounce correction invocation for the "non-hex-word" case
    When the correction recorder runs
    Then it refuses with reason "commit-not-ten-hex"
    And the correction store is unchanged
