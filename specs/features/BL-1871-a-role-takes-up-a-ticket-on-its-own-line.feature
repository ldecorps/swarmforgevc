Feature: BL-1871 A role takes up a ticket on that ticket's own line

  Today a role receives a parcel as "merge_and_process <sender> <commit>" and
  merges that commit into its own long-lived branch, so every ticket that
  ever passed through the role stays on its branch. The commit QA approves
  then carries other tickets' unapproved work, and the land step has to take
  it apart again (BL-1870's assessment: the QA branch was 16,590 commits past
  origin/main on 2026-10-01, and QA held each ticket for a median of 21
  minutes). From this ticket on, a task-mode role takes up a parcel by moving
  its worktree onto the parcel's commit, and the coder starts a new ticket
  from origin/main. Every commit on a parcel's line then belongs to its own
  ticket. The live pack runs the cleaner and the hardender in task mode,
  so they take up their parcels the same way, one at a time.

  Background:
    Given a fixture project whose origin main holds one commit
    And the architect's and the coder's branches each carry an unlanded commit of BL-9000

  # BL-1871 a-handed-off-parcel-is-taken-up-on-its-own-commit-01
  Scenario: the architect's worktree moves onto the parcel's commit instead of merging it
    Given the architect's inbox holds a git_handoff for BL-9001 citing a commit on BL-9001's own line
    When the architect asks for its next task
    Then the architect's worktree HEAD is that commit
    And the commit the architect held before is kept under a parcel-backup ref
    And no commit between origin/main and the architect's HEAD names a ticket other than BL-9001

  # BL-1871 work-on-top-is-never-moved-back-02
  Scenario: a parcel served again after the architect committed on top of it is not moved back
    Given the architect has taken up the git_handoff for BL-9001 and committed on top of it
    When the architect asks for its next task
    Then the architect's worktree HEAD is the architect's own commit

  # BL-1871 uncommitted-changes-block-the-move-03
  Scenario: a worktree holding an uncommitted tracked change is not moved
    Given the architect's worktree holds an uncommitted change to a tracked file
    And the architect's inbox holds a git_handoff for BL-9001 citing a commit on BL-9001's own line
    When the architect asks for its next task
    Then the architect's worktree HEAD has not moved
    And the output names the changed file and says the parcel was not taken up

  # BL-1871 the-coder-starts-a-ticket-on-its-own-line-04
  Scenario Outline: the coder starts a ticket from its newest handed-off commit, or else from origin/main
    Given <history>
    And the coder's inbox holds the note "Work BL-9002: build it"
    When the coder asks for its next task
    Then the coder's worktree HEAD is <start>

    Examples:
      | history                                                     | start                                     |
      | no commit has been handed off for BL-9002                   | origin/main                               |
      | a commit for BL-9002 was handed off to the cleaner earlier  | the newest commit handed off for BL-9002  |

  # BL-1871 a-parcel-with-no-work-moves-nothing-05
  Scenario Outline: a parcel that carries no work for the architect moves nothing
    Given the architect's inbox holds <parcel>
    When the architect asks for its next task
    Then the architect's worktree HEAD has not moved

    Examples:
      | parcel                                              |
      | a non-forwarding copy of a git_handoff for BL-9001  |
      | QA's merge-up note for BL-9001                      |

  # BL-1871 the-shared-master-checkout-never-moves-06
  Scenario: a master-resident role's shared checkout never moves
    Given the specifier and the coordinator share the master checkout on main
    And the specifier's inbox holds a git_handoff for BL-9001 citing a commit on BL-9001's own line
    When the specifier asks for its next task
    Then the master checkout's HEAD and branch have not changed

  # BL-1871 the-live-pack-takes-up-every-parcel-one-at-a-time-07
  Scenario: the live pack takes up the cleaner's and the hardender's parcels one at a time
    Given the live pack swarmforge/packs/full-forge.conf
    Then its cleaner and hardender windows declare task mode
