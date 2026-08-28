Feature: role inbox resolution covers master-resident roles as well as worktree roles

  A role's mailbox location depends on how that role is seated. Worktree
  roles keep their mail inside their own checkout; master-resident roles
  keep theirs in a role-named directory under the shared root. Resolution
  must return the real mailbox for both shapes, because every consumer that
  scans inboxes — dead-letter announcement above all — can only act on what
  resolution hands it.

  Background:
    Given a roles table seating "coder" in its own worktree
    And seating "coordinator" on master

  # BL-1219 role-inbox-resolution-covers-master-resident-01
  Scenario Outline: each role resolves to the mailbox its mail is actually delivered to
    When inbox resolution runs for "<role>"
    Then the resolved inbox is the one handoff delivery writes to for "<role>"
    And the resolved inbox is not the shared root inbox directory

    Examples:
      | role        |
      | coder       |
      | coordinator |

  # BL-1219 role-inbox-resolution-covers-master-resident-02
  Scenario: a dead letter to a master-resident role is seen by the notify sweep
    Given a dead-lettered handoff in the mailbox for "coordinator"
    When the dead-letter notify sweep runs
    Then the sweep reports that dead letter
    And it is either announced with a recorded reason or recorded as a named refusal

  # BL-1219 role-inbox-resolution-covers-master-resident-03
  Scenario: a dead letter to a worktree role is unaffected
    Given a dead-lettered handoff in the mailbox for "coder"
    When the dead-letter notify sweep runs
    Then the sweep reports that dead letter

  # BL-1219 role-inbox-resolution-covers-master-resident-04
  Scenario: the shared root inbox is nobody's mailbox
    Given a stale dead-lettered handoff in the shared root inbox directory
    When the dead-letter notify sweep runs
    Then the sweep reports no dead letter from that directory

  # BL-1219 role-inbox-resolution-covers-master-resident-05
  Scenario: an already-announced dead letter is not announced twice
    Given a dead-lettered handoff in the mailbox for "coordinator"
    And the notify sweep has already announced it
    When the dead-letter notify sweep runs again
    Then it is not announced a second time

  # BL-1219 role-inbox-resolution-covers-master-resident-06
  Scenario: the two language implementations agree on every seated role
    When inbox resolution runs for every role in the roles table
    Then each resolved inbox matches the one the handoff daemon resolves for that role
