Feature: Master-checkout drift does not WARN while a commit is in flight
  BL-839 alarms when daemon-executed scripts in the master checkout disagree
  with `main`. On a busy `main`, every agent `git add` creates a brief window
  where the index differs from `main` even though the staged bytes are the
  forward change about to land — the opposite of the 2026-08-06 staged
  *reversion* incident. That window floods Operator with false
  "STAGED (index) … one git commit away from landing the reversion" WARNs
  and trains humans to ignore the alarm. Mute WARN only while a commit (or
  index write) is observably in flight; keep BL-839's durable reversion
  detection. Source: human Cursor 2026-08-25, follow-on to done BL-839.

  Background:
    Given the daemons execute scripts from the master checkout's working tree

  # BL-1122 mid-commit-mute-01
  Scenario: agreement is still silent
    Given every daemon-executed script in the master checkout matches main
    And no commit is in flight on the master checkout
    When the drift check runs
    Then it reports no drift
    And it raises no alarm

  # BL-1122 mid-commit-mute-02
  Scenario: a durable staged reversion with no commit in flight still alarms
    Given a daemon-executed script is staged for reversion out of main
    And no commit is in flight on the master checkout
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1122 mid-commit-mute-03
  Scenario: the same index-vs-main disagreement is silent while a commit is in flight
    Given a daemon-executed script's index content differs from main
    And a commit is in flight on the master checkout
    When the drift check runs
    Then it raises no MASTER CHECKOUT DRIFT alarm this sweep

  # BL-1122 mid-commit-mute-04
  Scenario: the mute is not sticky after the in-flight signal clears
    Given a daemon-executed script is staged for reversion out of main
    And a commit was in flight and has now finished
    When the drift check runs
    Then it reports drift naming that script as staged for reversion
    And it raises a MASTER CHECKOUT DRIFT alarm

  # BL-1122 mid-commit-mute-05
  Scenario: the check never writes while deciding the mute
    Given a commit is in flight on the master checkout
    When the drift check runs
    Then the master checkout's index and worktree are unmodified by the check
