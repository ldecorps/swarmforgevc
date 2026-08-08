Feature: a failed integrity commit leaves the index exactly as it found it

  commit_integrity_lib.bb stages the caller's paths, commits them, and verifies
  the result. Every failure path after the staging step returns :success false
  and leaves those paths STAGED, with nothing in the result saying so.

  On a shared checkout that is the whole bug. Staged state is global: the next
  writer that commits without a pathspec carries the abandoned edit into its own
  unrelated commit. Measured 2026-08-08 in a fixture: a caller's path went from
  unstaged to staged across a failed call, and an unrelated writer's next
  `git commit -m` silently carried it.

  The irony is the point. This helper's own header says it exists so that "a
  concurrent writer's add/commit landing in the gap ... can either clear this
  process's staged change or sweep it into an unrelated commit" cannot happen —
  and it defends every OTHER writer by pathspec-scoping its own commits, while
  manufacturing exactly the leftover state that poisons a writer who does not.

  Background:
    Given a checkout whose index holds nothing staged
    And the caller has written its own change to disk unstaged

  # BL-856 no-staged-residue-on-failure-01
  Scenario Outline: a failed commit leaves nothing of the caller's staged
    When the integrity commit fails with <reason>
    Then the call reports failure
    And the caller's paths are unstaged again

    Examples:
      | reason           |
      | a commit failure |
      | a verify mismatch|
      | a staging failure|
      | a lock timeout   |

  # BL-856 restore-is-pathspec-scoped-02
  Scenario: another writer's staged path is left alone by the restore
    Given another writer has already staged a path of its own
    When the integrity commit fails with a commit failure
    Then the caller's paths are unstaged again
    And the other writer's staged path is still staged

  # BL-856 caller-prestaged-state-survives-03
  Scenario: a rename the caller staged before the call is still staged after it
    Given the caller staged a rename with git mv before calling
    When the integrity commit fails with a commit failure
    Then the staged rename is still staged

  # BL-856 restore-failure-is-loud-04
  Scenario: a restore that cannot complete is reported, never swallowed
    Given restoring the index will fail
    When the integrity commit fails with a commit failure
    Then the call reports failure
    And the result names the index as left dirty

  # BL-856 success-path-unchanged-05
  Scenario: a successful commit still commits the caller's change
    When the integrity commit succeeds
    Then the committed content matches what the caller wrote
    And the caller's paths are unstaged again

  # BL-856 unrelated-commit-carries-nothing-06
  Scenario: after a failed commit an unrelated writer's commit carries nothing of the caller's
    Given the integrity commit has already failed with a commit failure
    When an unrelated writer commits its own file with no pathspec
    Then that commit carries only the unrelated writer's file
