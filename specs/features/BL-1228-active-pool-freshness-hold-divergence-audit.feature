Feature: A ticket sitting in active/ under a standing freshness hold is reported

  Article 3.6 makes the deprecator freshness check fail closed: on a hold the
  ticket stays in backlog/paused/ until the specifier adjudicates. That posture
  is enforced in exactly one place — promote_and_route_next.sh, which consults
  deprecate-check.js before it moves anything. A promotion performed by hand
  never consults the CLI, so it walks past the gate, and afterwards nothing
  anywhere compares the pool a ticket sits in against the verdict its own
  freshness check still returns.

  On 2026-08-28 BL-1216 was moved from paused/ to active/ by a hand-rolled
  git mv while its hold was still standing and unadjudicated. Running
  deprecate-check.js against it the next morning still returned
  {"decision":"hold"} — the ticket was in the pipeline and the gate that was
  supposed to have stopped it still said no. Nothing had noticed, and nothing
  would have.

  This audit closes the observation gap only. It reports; a human, the
  specifier, or the coordinator acts on the report.

  Background:
    Given an empty backlog corpus

  # BL-1228 active-pool-freshness-hold-divergence-01
  Scenario: A ticket in the active pool whose freshness check holds is reported
    Given ticket "BL-0001" is in "backlog/active/"
    And the freshness check for "BL-0001" returns decision "hold" with reason "stale premise"
    When the active-pool freshness audit runs
    Then "BL-0001" is reported
    And the report for "BL-0001" carries the reason "stale premise"

  # BL-1228 active-pool-freshness-hold-divergence-02
  Scenario: A ticket in the active pool whose freshness check allows is not reported
    Given ticket "BL-0001" is in "backlog/active/"
    And the freshness check for "BL-0001" returns decision "allow"
    When the active-pool freshness audit runs
    Then "BL-0001" is not reported

  # BL-1228 active-pool-freshness-hold-divergence-03
  Scenario Outline: A freshness verdict the audit cannot positively read is reported, never treated as clear
    Given ticket "BL-0001" is in "backlog/active/"
    And the freshness check for "BL-0001" <check outcome>
    When the active-pool freshness audit runs
    Then "BL-0001" is reported

    Examples:
      | check outcome                  |
      | is missing from the checkout   |
      | exits non-zero                 |
      | prints unparseable output      |
      | prints an unrecognised decision |

  # BL-1228 active-pool-freshness-hold-divergence-04
  Scenario: A held ticket still sitting in the paused pool is not reported
    Given ticket "BL-0001" is in "backlog/paused/"
    And the freshness check for "BL-0001" returns decision "hold" with reason "stale premise"
    When the active-pool freshness audit runs
    Then "BL-0001" is not reported

  # BL-1228 active-pool-freshness-hold-divergence-05
  Scenario: An active pool with no standing holds reports nothing
    Given ticket "BL-0001" is in "backlog/active/"
    And ticket "BL-0002" is in "backlog/active/"
    And the freshness check for "BL-0001" returns decision "allow"
    And the freshness check for "BL-0002" returns decision "allow"
    When the active-pool freshness audit runs
    Then nothing is reported

  # BL-1228 active-pool-freshness-hold-divergence-06
  Scenario: The audit leaves every backlog file where it found it
    Given ticket "BL-0001" is in "backlog/active/"
    And the freshness check for "BL-0001" returns decision "hold" with reason "stale premise"
    When the active-pool freshness audit runs
    Then "BL-0001" is still in "backlog/active/"
    And no backlog file has been created, moved, deleted, or rewritten
