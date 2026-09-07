Feature: BL-1474 The replay reports why its commit was refused

  replay! builds the tip-pure commit in a scratch worktree and, when the
  git commit exits non-zero, reports "nothing to commit - own-paths
  identical to origin/main". That is true only when the index is empty.
  On 2026-09-07 the commit was refused by the merge-deletion guard for a
  real, forty-path index, and the escalate still said nothing to commit;
  QA rebuilt the commit by hand to read the guard's actual message. An
  escalate says what refused the commit, or that the index was empty,
  and never the one when the other is true.

  Background:
    Given a fixture repository with an origin and a parcel whose replay is being built

  # BL-1474 a-guard-refusal-is-reported-with-the-guards-own-message-01
  Scenario: a commit-time guard refusal is reported with the guard's own message
    Given the replay's index holds the parcel's paths and a commit-time guard refuses the commit
    When the replay attempts its commit
    Then the escalate reason carries the guard's own message
    And the reason does not say the own-paths are identical to origin/main

  # BL-1474 an-empty-index-is-reported-as-nothing-to-commit-02
  Scenario: an empty index is reported as nothing to commit
    Given the replay's index holds nothing because every own path equals origin/main
    When the replay attempts its commit
    Then the escalate reason says nothing to commit for the parcel

  # BL-1474 the-two-reasons-are-never-confused-03
  Scenario Outline: the reason names the real cause whatever the index holds
    Given the replay's index is <index> and the commit exits <exit>
    When the replay attempts its commit
    Then the escalate reason is <reason>

    Examples:
      | index     | exit                    | reason                  |
      | empty     | non-zero with no stderr | nothing to commit       |
      | non-empty | non-zero with stderr    | the stderr text         |
      | non-empty | non-zero with no stderr | commit refused, no text |
