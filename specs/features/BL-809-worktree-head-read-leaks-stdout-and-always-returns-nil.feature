Feature: the claim-risk sweep can actually read a worktree's HEAD

  # BL-809: worktree-head-commit-10 in babysitter_assess_lib.bb passes
  # {:err :string} to process/shell but never {:out :string}, so stdout is
  # inherited — the raw hash prints to the daemon's console every sweep, and
  # (:out result) is a NullInputStream rather than a string. (str/trim out)
  # then throws ClassCastException into a bare catch, so the function returns
  # nil on EVERY call, including when git succeeded.
  #
  # scan-claim-risks calls assess-one-claim without :head-commit, so this
  # broken fallback is the production path. head is always nil, so
  # head-unchanged? is always false, so three of the severity outcomes —
  # watch, warn-uncommitted, warn-fixture-droppings — are unreachable and
  # list-untracked-files is never called. The scenarios below are therefore
  # about the restored SEVERITIES, not about the hash: a fix that returns a
  # string while leaving the stall detection dark would satisfy the reported
  # symptom and none of this ticket's purpose.
  #
  # handoffd.bb has a correct implementation of the same read (process/sh,
  # which captures stdout by default, degrading to "" on error).

  Background:
    Given a role worktree with a claim-progress sidecar

  # BL-809 head-read-returns-the-commit-01
  Scenario: a successful HEAD read yields the commit, not a blank
    Given that worktree's git HEAD can be read
    When the claim-risk sweep reads that worktree's HEAD
    Then it yields the worktree's 10-character HEAD commit

  # BL-809 no-raw-git-output-on-stdout-02
  Scenario: the sweep does not print raw git output
    When the claim-risk sweep runs
    Then no raw git command output appears on the daemon's stdout

  # BL-809 stall-severities-are-reachable-03
  Scenario Outline: a claim whose HEAD has not moved reaches its stall severity
    Given the sidecar's claim commit equals the worktree's current HEAD
    And the claim has aged past three quarters of its idle timeout
    And the worktree's untracked files are <untracked-state>
    When the claim-risk sweep runs
    Then the assessment's severity is <severity>

    Examples:
      | untracked-state          | severity               |
      | none                     | watch                  |
      | ordinary untracked files | warn-uncommitted       |
      | only fixture droppings   | warn-fixture-droppings |

  # BL-809 untracked-files-are-actually-read-04
  Scenario: the sweep inspects untracked files once HEAD is readable
    Given the sidecar's claim commit equals the worktree's current HEAD
    And the claim has aged past three quarters of its idle timeout
    And the worktree's untracked files are ordinary untracked files
    When the claim-risk sweep runs
    Then the assessment reports a non-zero untracked file count

  # BL-809 moved-head-is-not-a-stall-05
  Scenario: a claim whose HEAD has moved is not reported as stalled
    Given the sidecar's claim commit differs from the worktree's current HEAD
    And the claim has aged past three quarters of its idle timeout
    When the claim-risk sweep runs
    Then no stall severity is reported for that claim

  # BL-809 unreadable-head-degrades-06
  Scenario: an unreadable HEAD degrades without crashing the sweep
    Given that worktree's git HEAD cannot be read
    When the claim-risk sweep runs
    Then that claim yields a blank head rather than raising
    And the sweep still assesses the remaining claims
