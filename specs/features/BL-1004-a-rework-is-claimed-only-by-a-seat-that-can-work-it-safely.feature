Feature: A stage queue hands a rework only to a seat that can work it safely

  BL-983 gave a multi-seat stage one addressable queue and let any idle seat
  claim from it. That is right for fresh work and wrong for a REWORK: the two
  coder seats hold separate worktrees on separate branches, so a bounce
  returning to the stage can land on a seat that has none of the parcel's
  history.

  Measured on 2026-08-20. BL-994 was built on coder@sonnet2 (782b343a4). The
  hardener's bounce addressed the coder STAGE and was claimed by seat coder,
  which wrote its fix commit 080b30253 on a tree that did not contain the
  build - the parcel commit is not an ancestor of the fix. It merged the
  parcel afterwards and the forward's lineage was sound, so the delivered
  work was correct; nothing guaranteed that. Two hazards were live for the
  whole window: the merge had to reconcile two independent edits to the same
  two files with no conflict marker owed (the BL-571/BL-954/BL-958 silent-drop
  family), and the amended acceptance scenario the fix was written against
  passes identically on pre- and post-patch code, so a green run at that point
  proved nothing.

  Background:
    Given a swarm where a parcel addresses a stage and a seat claims from that stage's queue

  # BL-1004 rework-claimed-by-a-safe-seat-01
  Scenario Outline: the stage queue hands a parcel only to a seat that can safely work it
    Given the coder stage has two seats, coder and coder@sonnet2
    And the stage queue holds a git_handoff for a task
    And the prior worker of that task is <prior>
    When seat <asking> asks for its next task
    Then the parcel <outcome>

    Examples:
      | prior         | asking        | outcome                  |
      | coder@sonnet2 | coder         | stays in the stage queue |
      | coder@sonnet2 | coder@sonnet2 | is claimed by that seat  |
      | none          | coder         | is claimed by that seat  |

  # BL-1004 deferral-is-bounded-02
  Scenario: a parcel is never stranded when the seat that holds it does not come back
    Given the coder stage has two seats, coder and coder@sonnet2
    And the stage queue holds a git_handoff for a task
    And the prior worker of that task is coder@sonnet2
    And that parcel has waited past the cross-seat claim deadline
    When seat coder asks for its next task
    Then the parcel is claimed by that seat
    And the claim tells the seat it did not build this parcel

  # BL-1004 single-seat-stage-unchanged-03
  Scenario: a single-seat stage never defers a parcel
    Given the cleaner stage has one seat
    And the stage queue holds a git_handoff for a task
    And the prior worker of that task is cleaner
    When seat cleaner asks for its next task
    Then the parcel is claimed by that seat
