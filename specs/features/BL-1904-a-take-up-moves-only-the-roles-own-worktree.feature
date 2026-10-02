Feature: BL-1904 A take-up moves only the running role's own registered worktree

  BL-1871's take-up moves "the worktree at the cwd's git toplevel" onto the
  parcel's line, for whatever role SWARMFORGE_ROLE names. Nothing checks that
  the checkout is that role's own. On 2026-10-02 QA ran BL-1317's feature
  from its worktree; the fixture's completion helper ends by exec'ing the
  REAL ready_for_next_task.sh, which cds into the real scripts dir, so the
  receive ran as the coder in QA's checkout. It read the live coder's
  BL-1901 parcel and moved swarmforge-QA onto origin/main twice mid-pass
  (parcel-backup refs coder/20261002T193822.908Z and
  coder/20261002T193937.077Z hold QA's heads), dropping QA's parcel off its
  line. A take-up now leaves any checkout that is not the running role's
  roles.tsv worktree exactly as it was.

  Background:
    Given a fixture repository with origin, and coder and QA worktrees registered in roles.tsv
    And the "coder" mailbox holds a git_handoff at a commit no worktree's branch carries

  # BL-1904 another-roles-checkout-is-never-moved-01
  Scenario: the coder's receive run from the QA worktree leaves the QA worktree in place
    When ready_for_next_task runs as "coder" from "the QA worktree"
    Then the QA worktree's branch and HEAD are unchanged
    And no parcel-backup ref is written
    And the output says the parcel was not taken up in that checkout

  # BL-1904 the-roles-own-checkout-still-moves-02
  Scenario Outline: the coder's receive run from inside its own worktree still takes up the parcel
    When ready_for_next_task runs as "coder" from "<checkout>"
    Then the coder worktree's branch is at the parcel's commit

    Examples:
      | checkout                               |
      | the coder worktree                     |
      | a subdirectory of the coder worktree   |

  # BL-1904 the-shared-master-checkout-is-never-moved-03
  Scenario: a master-resident role's receive leaves the shared checkout in place and prints no take-up line
    Given the specifier's roles.tsv row is the shared checkout with worktree-name master
    And the "specifier" mailbox holds a git_handoff at a commit no worktree's branch carries
    When ready_for_next_task runs as "specifier" from "the shared checkout"
    Then the shared checkout's branch and HEAD are unchanged
    And the output carries no PARCEL_LINE line
