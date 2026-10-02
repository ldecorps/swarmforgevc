Feature: BL-1898 A ticket's land record satisfies the close guard

  The close guard refuses an active-to-done commit unless the coordinator's
  mailbox holds a handoff from QA naming the ticket, or an expedite QA
  verdict record approves it (BL-1378). Since BL-1872, QA queues an approved
  parcel and the lander lands it. The lander sends QA's bookkeep note
  through swarm_handoff as the coordinator, so the note is not from QA, and
  every lander land's close is refused: BL-1887 landed as feb18315ea on
  2026-10-02 and could not be closed until QA re-sent the note by hand. The
  land step writes a durable land record for every land
  (.swarmforge/land-approvals), the store is_qa_ancestor.sh and the
  landed-ticket auto-close already read. The guard now reads it too, as one
  more path to approval and never a second definition of it.

  Background:
    Given a commit moving "BL-9001" from active to done

  # BL-1898 a-land-record-allows-the-close-01
  Scenario: a ticket whose land record names a commit on main can be committed to done
    Given the coordinator mailbox holds no QA handoff naming "BL-9001"
    And a land record names "BL-9001" with a commit that is an ancestor of main
    When the close guard validates the commit
    Then the close is allowed
    And the guard names the land record it relied on

  # BL-1898 a-land-record-must-match-the-ticket-and-main-02
  Scenario Outline: a land record grants a close only for the ticket it names and a commit on main
    Given the coordinator mailbox holds no QA handoff naming "BL-9001"
    And a land record that <record>
    When the close guard validates the commit
    Then the close is refused

    Examples:
      | record                                                       |
      | names a different ticket                                     |
      | names "BL-9001" with a commit that is not an ancestor of main |

  # BL-1898 a-coordinator-sent-note-is-not-sign-off-03
  Scenario: a bookkeep note sent as the coordinator still does not approve a close by itself
    Given the coordinator mailbox holds a note from the coordinator naming "BL-9001"
    And no land record names "BL-9001"
    When the close guard validates the commit
    Then the close is refused

  # BL-1898 an-unreadable-land-record-is-not-a-pass-04
  Scenario: a land record store that cannot be read refuses the close and says why
    Given the coordinator mailbox holds no QA handoff naming "BL-9001"
    And the land record store holds a line that is not a record
    When the close guard validates the commit
    Then the close is refused
    And the refusal names the land record store
