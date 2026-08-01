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

  # BL-631 finding-rides-the-standard-nudge-path-03
  Scenario: a critical finding is shaped and routed like every other babysitterd finding
    Given a critical finding was just produced for an offending commit
    When the sweep's findings are assembled
    Then the finding carries a key, a severity of CRIT, and a message naming the commit
    And it is nudge-eligible on the same rule as every other CRIT finding

  # BL-631 finding-key-is-per-offending-sha-04
  Scenario: the finding's key is specific to the offending commit
    Given a critical finding was just produced for an offending commit
    When the finding's key is inspected
    Then the key identifies that commit and no other

  # BL-631 already-nudged-sha-does-not-renudge-05
  Scenario: a sha already nudged does not nudge again on the following sweep
    Given an offending commit sha was nudged as critical on the previous sweep
    And that commit is still on main
    When the babysitter sweep runs again
    Then the finding is produced again
    And no new nudge is sent for that sha

  # BL-631 distinct-sha-nudges-while-first-deduped-06
  Scenario: a second offending commit nudges even while the first is still deduped
    Given an offending commit sha was nudged as critical on the previous sweep
    And a different offending commit is now on main
    When the babysitter sweep runs again
    Then a nudge is sent naming the second commit

  # BL-631 regression-fixture-2026-07-25-07
  Scenario: the 2026-07-25 regression set reproduces exactly
    Given the commit set from the 2026-07-25 BL-590 incident window
    When the babysitter sweep runs over that set
    Then commits 4851901ed, 73706d79e, 8e76f8f10, ebd12542d, e05c025d4, and cce634a6c are all critical
    And commits b03e17429 and cb85b9e4b produce no finding
