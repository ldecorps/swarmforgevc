Feature: Landing on main must not leave conflict resolution to an external human

  # BL-1130 — draft acceptance (specifier may tighten). Automated land/absorb
  # either completes conflict-free or clean-refuses; never leaves MERGE_HEAD
  # for an operator to finish.

  Background:
    Given a master checkout that runs BL-891-style origin/main absorb

  Scenario: conflicted absorb refuses clean without mid-merge leftover
    Given local main is ahead of origin/main
    And absorbing origin/main would conflict on a landing ticket path
    When the automated absorb path runs
    Then the worktree has no MERGE_HEAD
    And there are no unmerged paths
    And the outcome names rematch or refuse (not finish-this-merge-in-an-editor)

  Scenario: a prepared land absorbs without human conflict editing
    Given a ticket land prepared under the BL-1130 rule
    When origin/main is absorbed into local main by the automated path
    Then behind is 0
    And no human conflict-resolution step was required
