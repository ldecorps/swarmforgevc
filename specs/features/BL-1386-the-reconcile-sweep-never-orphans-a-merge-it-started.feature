Feature: BL-1386 The reconcile sweep never orphans a merge it started

  After local main and origin/main have diverged without conflict, the
  reconcile sweep runs a real merge on the shared checkout and, if that
  merge fails, aborts it and falls back. The abort's result is discarded,
  the daemon keeps no record of which merge it started, and the log asserts
  the word conflict whatever git said. An abort that fails leaves the
  daemon's own MERGE_HEAD for the next tick, which then calls it a human's
  and protects it. This feature is that a merge the daemon starts is owned
  on disk, aborted by ownership when the first abort fails, and reported
  with git's own words.

  Background:
    Given a fixture checkout whose local main and origin/main have diverged without conflict
    And the reconcile sweep's real merge is refused after MERGE_HEAD is written

  # BL-1386 a-started-merge-is-owned-before-it-runs-01
  Scenario: the daemon records ownership before the merge and clears it after a clean abort
    When one sweep tick runs
    Then the ownership record named the merged sha before the merge ran
    And after the tick MERGE_HEAD is absent
    And the ownership record is cleared

  # BL-1386 a-failed-abort-is-recorded-not-forgotten-02
  Scenario: a failed abort leaves the ownership record and a log line naming the failure
    Given another process holds the index lock while the abort runs
    When one sweep tick runs
    Then after the tick MERGE_HEAD is present
    And the ownership record names the MERGE_HEAD sha
    And the log carries merge-abort-failed with the lock error text
    And the log does not carry real-merge-attempted-and-aborted for that tick

  # BL-1386 the-next-tick-aborts-by-ownership-03
  Scenario: the next tick aborts the merge it owns instead of calling it a human's
    Given the previous tick left an owned MERGE_HEAD because its abort failed
    And the index lock has been released
    When one sweep tick runs
    Then after the tick MERGE_HEAD is absent
    And the ownership record is cleared
    And human-merge-in-progress was never surfaced for that MERGE_HEAD

  # BL-1386 a-foreign-merge-is-still-never-aborted-04
  Scenario Outline: a MERGE_HEAD the daemon cannot prove it started is left alone
    Given a MERGE_HEAD created outside the sweep with <record state>
    When one sweep tick runs
    Then after the tick MERGE_HEAD is present
    And the sweep surfaces it exactly as it does today

    Examples:
      | record state                              |
      | no ownership record                       |
      | an ownership record naming another sha    |

  # BL-1386 the-log-says-what-git-said-05
  Scenario Outline: a failed real merge is logged with the observed outcome and git's text
    Given the real merge fails because of <cause>
    When one sweep tick runs
    Then the log carries <label> with git's error text

    Examples:
      | cause                          | label        |
      | a genuine content conflict     | conflict     |
      | a pre-merge-commit hook refusal | merge-failed |
