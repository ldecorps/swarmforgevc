Feature: BL-1778 A driver seat's give-up reverts only the attempt's own commits
  A local driver seat that gives a parcel up (BL-1715) takes its failed attempt
  out of its branch by revert, never by reset. Only the commits the
  attempt itself made are reverted. The claim's merge of main and of the
  received commit are kept. They are not the attempt's work, and
  reverting a merge makes git treat its content as merged and removed
  (the BL-490/BL-1348 shape): a later merge would not bring it back, and
  the seat's next forward would delete it downstream. The seat's tree
  after a give-up is its tree just after the claim's merges.

  Background:
    Given a fixture coder stage with a Claude seat "coder" and a driver seat "coder@2"

  # BL-1778 the-give-up-keeps-what-the-claim-merged-01
  Scenario Outline: the give-up keeps what the claim merged
    Given coder@2 claimed a parcel whose claim merged <claim merge>
    And coder@2's attempt committed changes that its gate still fails after the last fix turn
    When the driver finishes coder@2's last fix turn
    Then coder@2's checkout has the tree it had right after the claim's merges
    And no commit reachable from coder@2's post-merge head is reverted

    Examples:
      | claim merge                              |
      | the received commit as a merge commit    |
      | the received commit as a fast-forward    |
      | main and then the received commit        |

  # BL-1778 the-given-up-branch-deletes-nothing-downstream-02
  Scenario: merging the given-up branch downstream deletes nothing
    Given coder@2 claimed a parcel whose claim merged main and then the received commit
    And coder@2's attempt committed changes that its gate still fails after the last fix turn
    And the driver has finished coder@2's last fix turn
    When coder@2's branch is merged into a branch that already holds that main and that received commit
    Then the merge changes no file

  # BL-1778 the-give-up-records-one-outcome-row-03
  Scenario: the give-up records one outcome row
    Given coder@2 claimed a parcel whose claim merged the received commit as a merge commit
    And coder@2's attempt committed changes that its gate still fails after the last fix turn
    When the driver finishes coder@2's last fix turn
    Then one outcome row records coder@2, its model, the ticket, "given-up", the failed condition and the fix turns used
