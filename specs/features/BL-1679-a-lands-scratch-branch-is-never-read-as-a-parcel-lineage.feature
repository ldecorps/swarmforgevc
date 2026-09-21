Feature: BL-1679 a land's scratch branch is never read as a parcel lineage
  The land step's land-replay/<ticket>-<sha> branch is a land's private
  working state. The pre-QA ancestry gate reads each pipeline role's
  parcel lineage from the roster's own branch, warning when the worktree
  is checked out elsewhere, and the land step sweeps every land-replay ref
  whose tip is already on origin/main before it prints a plan. A ref whose
  tip is not on origin/main is reported with its age and never deleted.

  Background:
    Given a fixture repository cloned from a bare origin whose main holds a landed history
    And a roster row for QA whose branch swarmforge-QA is checked out at its own worktree

  # BL-1679 the-gate-reads-the-roster-branch-not-the-checkout-01
  # BL-1515 roster shape: a real roles.tsv row whose worktree HEAD is not on the roster branch.
  Scenario: the pre-QA ancestry gate reads QA's roster branch while QA's checkout sits on a land scratch branch
    Given swarmforge-QA carries no commit naming BL-0001
    And QA's worktree is checked out on land-replay/BL-0001-abcdef1234 whose tip names BL-0001 and touches a path of BL-0001's parcel
    When the pre-QA ancestry gate runs for BL-0001 against a parcel tip that does not contain that tip
    Then the gate reports no stranded finding
    And it prints exactly one warning naming QA, the checkout branch and the roster branch it read instead

  # BL-1679 a-landed-replay-ref-is-swept-02
  Scenario Outline: the replay-ref sweep deletes only a ref whose tip is already on origin/main
    Given a ref land-replay/BL-0002-<short> whose tip is <where>
    When the land step's replay-ref sweep runs
    Then the ref is <outcome>
    And the sweep's report <report>

    Examples:
      | short      | where                      | outcome | report                                  |
      | 1111111111 | an ancestor of origin/main | deleted | lists it under swept                    |
      | 2222222222 | not on origin/main         | kept    | names it as unlanded with its age       |

  # BL-1679 the-sweep-runs-before-every-plan-03
  Scenario: a land step plan leaves no landed land-replay ref behind
    Given two refs land-replay/BL-0003-aaaaaaaaaa and land-replay/BL-0003-bbbbbbbbbb whose tips are ancestors of origin/main
    And a ref land-replay/BL-0005-cccccccccc whose tip is not on origin/main
    When the land step plans a land for an approved BL-0004 parcel
    Then both BL-0003 refs are gone before the plan line is printed
    And the BL-0005 ref still exists and the plan output names it as unlanded
