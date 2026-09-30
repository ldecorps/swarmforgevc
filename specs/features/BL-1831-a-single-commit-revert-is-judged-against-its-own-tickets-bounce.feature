Feature: BL-1831 A single-commit revert is judged against its own ticket's bounce, never the latest one anywhere
  The bounce-revert scope guard (BL-1471) finds the bounced ticket from a
  reverted MERGE's second parent. A revert of a single commit has no second
  parent, so the guard fell back to whichever ticket was bounced most
  recently anywhere, and judged the revert against that unrelated ticket.
  It refused the very revert the merge-drop guard (BL-1576) names as the
  remedy for a dropped hunk: a documenter reverting its own earlier commit
  on BL-1815 was judged as BL-1820. The guard now attributes a single-commit
  revert to the ticket the reverted commit's own subject names, and a
  revert whose ticket has no bounce record is not a bounce revert at all.

  Background:
    Given a fixture repository whose bounce store's most recent record is a spec-gap bounce of BL-9002

  # BL-1831 own-ticket-attribution-01
  Scenario: a single-commit revert is judged against the bounce of the ticket its reverted commit names
    Given BL-9001 has a behavior bounce record
    And a commit "BL-9001: add a doc paragraph" touching only BL-9001's path
    When that commit is reverted as a single commit
    Then the commit guard chain accepts the revert

  # BL-1831 no-bounce-no-verdict-02
  Scenario: a single-commit revert of a ticket with no bounce record is not refused by this guard
    Given BL-9003 has no bounce record
    And a commit "BL-9003: add a doc paragraph" touching only BL-9003's path
    When that commit is reverted as a single commit
    Then the bounce-revert scope guard does not refuse it

  # BL-1831 merge-revert-unchanged-03
  Scenario: a merge revert is still attributed through the merge's second parent
    Given a review merge of BL-9002's parcel
    When that merge is reverted with -m 1
    Then the guard judges it against BL-9002's spec-gap bounce and refuses it as an omission-class revert
