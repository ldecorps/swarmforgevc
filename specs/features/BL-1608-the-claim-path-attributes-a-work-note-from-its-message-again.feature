Feature: BL-1608 The claim path attributes a Work note's ticket from its message again

  BL-1185 (landed 2026-08-27) made the hard coder seat resolve a Work note's
  mutation cost from its "Work BL-..." message when the note carries no
  task header, because task is git_handoff-only and a hard seat that sees a
  nil cost defers the note to an idle easy sibling and prints NO_TASK while
  the ambulance patient's mail sits in new. BL-1167's land the same day
  (ccc63d8cfd) rewrote the claim predicate and replaced that attribution
  with a bare task-header read, so the fault BL-1185 fixed came back and
  its scenario 02 has been red on main since, first recorded on 2026-09-16
  by the coder's full acceptance run for BL-1602. The effort applied at the
  claim moment (BL-1316) reads the same bare header. This feature is that
  both claim-time readers resolve the claimed ticket through one shared
  attribution that prefers the task header and falls back to the Work
  message, so the two can never drift apart again; BL-1185's own feature
  resolving green is QA's e2e step and this ticket's register row.

  # BL-1608 claim-path-attributes-a-work-note-from-its-message-01
  Scenario: both claim-time cost readers resolve the task through the one shared attribution
    When the source of swarmforge/scripts/ready_for_next_task.bb is read
    Then the claim predicate and the claim-moment effort apply both resolve the task through the shared attribution
    And neither of them reads the task header directly for a mutation cost
    And exactly 2 call sites of the shared attribution exist in that file

  # BL-1608 claim-path-attributes-a-work-note-from-its-message-02
  Scenario Outline: the shared attribution prefers the task header and falls back to the Work message
    Given a handoff file whose headers <headers> and whose message is <message>
    When the shared attribution resolves the task for it
    Then it resolves <resolved>

    Examples:
      | headers                                   | message                                   | resolved                                  |
      | carry task BL-1174-deprecate-operator-verbs | Work BL-9999-other                        | BL-1174-deprecate-operator-verbs          |
      | carry no task                             | Work BL-1174-deprecate-operator-verbs-scan-docs | BL-1174-deprecate-operator-verbs-scan-docs |
      | carry no task                             | please merge main and re-read the ticket  | nothing                                   |
