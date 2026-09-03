Feature: The post-QA sweep tells the roles it could not settle

  BL-668 ships a post-QA sweep that fast-forwards clean pipeline role branches
  to the landed commit, so no role spends an LLM turn on a merge that git can
  do in two seconds. A branch it cannot fast-forward, or a worktree that is
  dirty or holds in_process work, is "surfaced to its role untouched".

  Surfaced means logged. `record-surface!` appends to the sweep's own state and
  calls `log!`; nothing reaches the role. Measured across the daemon logs on
  2026-09-03: 125 surfacings and 3 fast-forwards. The role is never told, so
  the branch simply stays behind until someone notices.

  The half this feature covers is the telling. What the sweep DOES to a branch
  is unchanged: fast-forward only, never a merge, reset, rebase or stash.

  Background:
    Given the post-QA sweep has run against a landed commit

  # BL-1361 the-sweep-tells-the-roles-it-could-not-settle-01
  Scenario: a role whose branch was fast-forwarded is not told
    Given the sweep fast-forwarded a role's branch
    When the sweep finishes
    Then that role is told nothing

  # BL-1361 the-sweep-tells-the-roles-it-could-not-settle-02
  Scenario: a role already told is not told again on the next sweep
    Given the sweep surfaced a role for a reason it was already told about
    When the sweep finishes
    Then that role is told nothing

  # BL-1361 the-sweep-tells-the-roles-it-could-not-settle-03
  Scenario Outline: every surfacing reason reaches its role
    Given the sweep surfaced a role because of <reason>
    When the sweep finishes
    Then that role is told its branch is behind the landed commit
    And the reason it was surfaced is named

    Examples:
      | reason              |
      | a dirty worktree    |
      | in_process work     |
      | a divergent branch  |

  # BL-1361 the-sweep-tells-the-roles-it-could-not-settle-04
  Scenario: a role that cannot be told does not withhold the others
    Given the sweep surfaced two roles
    And telling the first one fails
    When the sweep finishes
    Then the second role is still told
    And the failure to tell the first is logged
