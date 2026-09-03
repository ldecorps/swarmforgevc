Feature: Landing an approved commit is one command

  `land_main_publish.sh` documents its own caller protocol in its header:
  "Callers that push must acquire the land lock first, rematch if advised, then
  push FF-only (never force). Residual races rematch at most once then wait on
  the lock." It exposes `--acquire-lock`, `--decide-only` and `--release-lock`,
  and nothing implements that protocol.

  QA performs it by hand after every approval, alongside the entanglement check
  `land_step_cli.bb` supplies and the GitHub issue close for a GH-seeded ticket.
  Every step is fixed; the sequence is not the judgement. The judgement is what
  to do when the entanglement check escalates, and that stays QA's.

  Three hazards bound this. A force-push is never correct here. A land that
  fails must not leave the lock held, or it blocks every later land. And an
  escalation must never be resolved by the tool - it stops and reports.

  Background:
    Given QA has approved a commit for a ticket

  # BL-1366 landing-an-approved-commit-is-one-command-01
  Scenario: a clean commit is landed on the first attempt
    Given the entanglement check reports the commit clean
    And origin has not moved since the check
    When QA lands the approved commit
    Then the commit is pushed to main without force
    And the land lock is released

  # BL-1366 landing-an-approved-commit-is-one-command-02
  Scenario: a moved origin is rematched once and then landed
    Given the entanglement check reports the commit clean
    And origin has moved since the check
    When QA lands the approved commit
    Then the commit is rematched onto the current origin tip once
    And the commit is pushed to main without force
    And the land lock is released

  # BL-1366 landing-an-approved-commit-is-one-command-03
  Scenario: a second race waits on the lock rather than rematching again
    Given the entanglement check reports the commit clean
    And origin moves again after the first rematch
    When QA lands the approved commit
    Then the land waits on the lock
    And the commit is rematched no more than once

  # BL-1366 landing-an-approved-commit-is-one-command-04
  Scenario: an escalation stops the land and changes nothing
    Given the entanglement check escalates
    When QA lands the approved commit
    Then the land stops and reports the escalation
    And main is unchanged
    And the land lock is released

  # BL-1366 landing-an-approved-commit-is-one-command-05
  Scenario Outline: the lock is released whatever ends the land
    Given the land ends in <ending>
    When QA lands the approved commit
    Then the land lock is released

    Examples:
      | ending            |
      | a successful push |
      | a rejected push   |
      | an escalation     |
      | an unexpected error |

  # BL-1366 landing-an-approved-commit-is-one-command-06
  Scenario: a GitHub-seeded ticket has its issue closed on a successful land
    Given the ticket was seeded from a GitHub issue
    And the entanglement check reports the commit clean
    When QA lands the approved commit
    Then the GitHub issue is closed
