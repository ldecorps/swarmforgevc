Feature: Work notes attribute mutation cost from Work BL message when task header is absent

  # BL-1185: ambulance patient BL-1174 Work notes lack task: so hard-seat
  # difficulty-allows-claim? sees nil cost and :defer-better-fit to easy
  # sibling — NO_TASK while patient mail sits in new/. task: is git_handoff-only
  # (swarm_handoff validation); durable fix is message attribution — same as
  # supersede_lib/task-name-from-content — not stamping task: onto notes.

  Background:
    Given BL-1001 seat difficulty routing is in force
    And an ambulance is engaged on a high mutation cost ticket

  # BL-1185 work-note-without-task-uses-message-01
  Scenario: a Work note without task header still resolves mutation cost from its message
    Given a note whose message is Work BL-1174-deprecate-operator-verbs-scan-docs
    And the note has no task header
    And that ticket yaml declares mutation cost high
    When the hard coder seat evaluates whether it may claim the note
    Then the claim path treats the cost as high
    And the decision is not defer-better-fit solely because task was nil

  # BL-1185 hard-seat-claims-ambulance-patient-02
  Scenario: the hard seat claims an ambulance patient Work note when easy is idle
    Given ambulance is engaged on BL-1174
    And a Work note for BL-1174 sits in the hard coder inbox new
    And the easy coder sibling is idle
    And BL-1174 declares mutation cost high
    When the hard seat runs ready for next
    Then the Work note is claimed rather than skipped as defer-better-fit
    And the seat does not print NO_TASK solely for nil task cost

  # BL-1185 task-header-remains-illegal-on-notes-03
  Scenario: Work route notes stay type note without a task header
    When the coordinator promote or Work route emits a note for a ticket
    Then the handoff type is note
    And the note does not carry a task header
    And swarm_handoff still refuses task on notes as git_handoff-only

  # BL-1185 nil-task-non-work-note-unchanged-04
  Scenario: a non-Work note with no task header still has nil cost
    Given a note with no task header and a message that is not a Work BL route
    When mutation cost is resolved for seat difficulty
    Then the cost remains unset
    And existing defer-better-fit behaviour for truly unattributed notes is unchanged
