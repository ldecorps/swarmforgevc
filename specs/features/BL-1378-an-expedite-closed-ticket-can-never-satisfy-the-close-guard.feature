Feature: BL-1378 An expedite-closed ticket can satisfy the close guard

  The close guard refuses an active-to-done commit unless QA sent the
  coordinator a handoff naming the ticket. An expedite run is forbidden from
  touching the mailboxes at all, so it can never produce one, and no ticket it
  finishes can ever be committed to done. The expeditor does already write a
  durable QA verdict record that the one approval predicate reads, so this
  feature is that the guard reads the same record - as an additional path to
  approval, never a second definition of it, and never a way for a missing or
  unreadable record to become a pass.

  Background:
    Given a commit moving "BL-9001" from active to done

  # BL-1378 an-expedite-verdict-record-allows-the-close-01
  Scenario: a ticket with an expedite QA verdict record can be committed to done
    Given an expedite QA verdict record for ticket "BL-9001" with approval true
    And the approved commit is an ancestor of main
    When the close guard validates the commit
    Then the close is allowed
    And the guard names the expedite verdict record it relied on

  # BL-1378 the-normal-path-is-unchanged-02
  Scenario Outline: the mailbox path keeps deciding every close that has no expedite record
    Given no expedite verdict record for ticket "BL-9001"
    And the coordinator mailbox <mailbox>
    When the close guard validates the commit
    Then the close is <outcome>

    Examples:
      | mailbox                                   | outcome |
      | holds a QA handoff naming "BL-9001"       | allowed |
      | holds no QA handoff naming "BL-9001"      | refused |

  # BL-1378 a-record-must-match-the-ticket-stage-and-approval-03
  Scenario Outline: a record grants a close only when it names this ticket, the QA stage, and approval
    Given an expedite verdict record that <record>
    And the coordinator mailbox holds no QA handoff naming "BL-9001"
    When the close guard validates the commit
    Then the close is refused

    Examples:
      | record                            |
      | names a different ticket          |
      | carries a stage other than QA     |
      | carries approval false            |

  # BL-1378 landed-on-main-is-also-required-04
  Scenario: an approved commit that never reached main does not close its ticket
    Given an expedite QA verdict record for ticket "BL-9001" with approval true
    And the approved commit is not an ancestor of main
    When the close guard validates the commit
    Then the close is refused
    And the guard names the commit that never reached main

  # BL-1378 an-unusable-store-refuses-rather-than-passes-05
  Scenario Outline: a store that cannot be trusted refuses the close and says why
    Given the expedite verdict store is <store>
    And the coordinator mailbox holds no QA handoff naming "BL-9001"
    When the close guard validates the commit
    Then the close is refused
    And the guard names the store problem

    Examples:
      | store                                 |
      | obstructed by a file                  |
      | unreadable                            |
      | holding a record line with no commit  |
      | holding a record line with no approval|

  # BL-1378 an-absent-store-is-not-an-approval-06
  Scenario: an absent store falls back to the mailbox check and is never itself an approval
    Given the expedite verdict store does not exist
    And the coordinator mailbox holds no QA handoff naming "BL-9001"
    When the close guard validates the commit
    Then the close is refused
    And the guard reports the missing QA approval, not a store problem
