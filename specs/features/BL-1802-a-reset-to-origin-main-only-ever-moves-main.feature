Feature: BL-1802 A reset to origin/main only ever moves main

  Four scripts reset a checkout to origin/main, all through
  master_main_reconcile_lib's refuse-reset-if-local-ahead!: handoffd.bb,
  swarm_heal.bb, post_hotfix_merge_origin.bb and the lib's own
  real-git-reset-adapters. The gate authorises the reset from main's
  ahead count, then runs git reset --hard origin/main in whatever checkout
  it was given. main is a shared ref, so in a linked worktree on another
  branch the count reads 0 and the reset moves that worktree's own branch,
  discarding commits origin/main lacks. That happened to swarmforge-QA at
  12:05:28Z on 2026-09-29, inside QA's pre-commit property run, where the
  BL-1124 guard caught it. The gate now also requires the checkout to be on
  main. Every scenario runs against a bare origin, a clone and a linked
  worktree under mkdtemp (BL-1390).

  Background:
    Given a fixture origin and a clone on main whose main equals origin/main

  # BL-1802 a-reset-off-main-is-refused-01
  Scenario Outline: a reset in a checkout that is not on main is refused and moves nothing
    Given <checkout> holding one commit origin/main lacks
    When the reset to origin/main runs in that checkout
    Then it refuses with the outcome "not-on-main-refused"
    And that checkout still holds its own commit

    Examples:
      | checkout                                   |
      | a linked worktree on branch swarmforge-QA  |
      | a linked worktree on a detached HEAD       |

  # BL-1802 a-reset-on-main-behaves-as-today-02
  Scenario: a reset in the clone on main still moves main to origin/main
    Given origin/main has one commit the clone's main has not merged
    When the reset to origin/main runs in the clone
    Then the clone's main points at origin/main

  # BL-1802 a-caller-without-a-branch-reading-is-refused-03
  Scenario: a caller that gives the gate no way to read the branch is refused
    When the gate is called without a current-branch reading
    Then it refuses with the outcome "not-on-main-refused"
    And the reset adapter was never called

  # BL-1802 every-reset-site-reads-the-branch-04
  Scenario: every script that resets to origin/main hands the gate a branch reading
    When the scripts that run a reset to origin/main are found by their reset command
    Then each passes a current-branch reading to refuse-reset-if-local-ahead!
    And the census is exactly 4 scripts and includes "swarmforge/scripts/handoffd.bb"
