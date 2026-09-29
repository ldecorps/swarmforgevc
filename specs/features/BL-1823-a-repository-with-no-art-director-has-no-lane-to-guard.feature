Feature: BL-1823 A repository with no art director has no art-director lane to guard
  BL-1657 taught the art-director tip guard to find the art director's
  branch from the roster, and to refuse any merge when the branch it
  resolves does not exist. With no art-director row in roles.tsv it falls
  back to the swarmforge-art-director convention, and in a repository that
  has no art director at all that branch never exists, so every merge
  through the pre-merge-commit chain is refused. A fixture repository with
  no art director, a greenfield target, or a second swarm without the seat
  cannot merge. The guard now passes when the roster names no art
  director and the convention branch does not exist: there is no lane to
  guard. A roster row it cannot resolve still refuses, and an existing
  art-director branch is still judged by the lane rule.

  Background:
    Given a fixture repository whose pre-merge-commit chain runs the art-director tip guard

  # BL-1823 no-art-director-no-lane-01
  Scenario: a merge in a repository with no art-director row and no art-director branch commits
    Given roles.tsv has no art-director row
    And no swarmforge-art-director branch exists
    When an ordinary branch is merged
    Then the merge commits

  # BL-1823 unresolvable-roster-row-still-refuses-02
  Scenario: an art-director roster row whose worktree cannot be read still refuses the merge
    Given roles.tsv names an art-director worktree that cannot be read
    When an ordinary branch is merged
    Then the merge is refused naming that worktree

  # BL-1823 existing-branch-still-judged-03
  Scenario: an existing art-director branch is still judged by the lane rule
    Given roles.tsv has no art-director row
    And the swarmforge-art-director branch carries a commit touching a path outside the art director's lane
    When the swarmforge-art-director branch is merged
    Then the merge is refused naming the out-of-lane path
