Feature: babysitter sweep detects pipeline code landing on main outside the QA path

  # BL-631, BL-590 post-mortem 2026-07-25: the cleaner ran an entire pass in
  # the master checkout (a `cd` habit, not a rotation bug), landing four
  # un-QA'd commits on main. Nothing errored and nothing told anyone — an
  # architect found it hours later by eye. The refined path filter
  # (extension/src/, extension/test/, specs/pipeline/steps/, excluding
  # backlog/, docs/, swarmforge/, specs/features/ where specifier and
  # coordinator legitimately commit) was measured against the 2026-07-25
  # window: 8 true CRITs, zero false positives.

  # BL-631 offending-commit-fires-critical-01
  Scenario: a non-QA-ancestor commit touching pipeline code fires a critical finding
    Given a commit on main that is not an ancestor of swarmforge-QA
    And that commit touches extension/src/
    When the babysitter sweep runs
    Then a critical finding names the offending commit sha and path

  # BL-631 bookkeeping-commit-produces-no-finding-02
  Scenario Outline: a non-QA-ancestor commit touching only bookkeeping paths produces no finding
    Given a commit on main that is not an ancestor of swarmforge-QA
    And that commit touches only <bookkeeping path>
    When the babysitter sweep runs
    Then no finding is produced for that commit

    Examples:
      | bookkeeping path  |
      | backlog/           |
      | docs/               |
      | swarmforge/         |
      | specs/features/     |

  # BL-631 finding-reaches-wake-queue-03
  Scenario: a critical finding reaches the wake queue in the same shape as a claim-progress finding
    Given a critical finding was just produced for an offending commit
    When the wake queue is inspected
    Then the finding is visible there in the same record shape as a claim-progress finding

  # BL-631 already-reported-sha-does-not-realarm-04
  Scenario: a sha already reported does not re-alarm on the following tick
    Given an offending commit sha was reported as critical on the previous tick
    When the babysitter sweep runs again with no new offending commits
    Then no new finding is produced for that same sha

  # BL-631 regression-fixture-2026-07-25-05
  Scenario: the 2026-07-25 regression set reproduces exactly
    Given the commit set from the 2026-07-25 BL-590 incident window
    When the babysitter sweep runs over that set
    Then commits 4851901ed, 73706d79e, 8e76f8f10, ebd12542d, e05c025d4, and cce634a6c are all critical
    And commits b03e17429 and cb85b9e4b produce no finding
