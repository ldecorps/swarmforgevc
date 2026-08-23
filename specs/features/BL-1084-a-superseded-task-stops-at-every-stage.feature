Feature: A superseded task stops at every stage, not only the one a note reached
  Superseding a ticket mid-flight is a note to one role today. A ticket whose
  commits have already been forwarded is not held by one role, so the note stops
  one stage and the work continues down the chain. Recording a supersede must
  instead leave a durable marker that every role's turn-start already looks at,
  so whichever stage next picks the parcel up refuses it.

  A refused parcel is not a defective one. It stays where it is and no bounce is
  charged against the role that built it.

  Background:
    Given a supersede is recorded for task "BL-1052-qwen-code-seat" with reason "reframed to local-model"

  # BL-1084 superseded-task-stops-at-every-stage-01
  # Rows are representative, not exhaustive: a task-mode role, a batch-mode
  # role, and the final gate. The property "every stage" is the ticket's
  # invariant 1; enumerating all six here would restate it six times without
  # covering a distinct behaviour. Scenarios 03 and 06 add architect and
  # cleaner in their own right.
  Scenario Outline: Every stage refuses a parcel for a superseded task
    Given role "<role>" has a parcel for task "BL-1052-qwen-code-seat" in its inbox
    When role "<role>" starts a turn
    Then the turn is refused
    And the refusal names the task "BL-1052-qwen-code-seat" and the reason "reframed to local-model"
    And the parcel is still in role "<role>"'s inbox

    Examples:
      | role      |
      | coder     |
      | hardender |
      | QA        |

  # BL-1084 superseded-task-stops-at-every-stage-02
  Scenario: A parcel for any other task is unaffected
    Given role "cleaner" has a parcel for task "BL-1099-unrelated" in its inbox
    When role "cleaner" starts a turn
    Then the turn is not refused
    And the parcel for task "BL-1099-unrelated" is dispatched normally

  # BL-1084 superseded-task-stops-at-every-stage-03
  Scenario: A refused parcel is not recorded as a bounce
    Given role "architect" has a parcel for task "BL-1052-qwen-code-seat" in its inbox
    When role "architect" starts a turn
    Then the turn is refused
    And no bounce is recorded against role "architect"

  # BL-1084 superseded-task-stops-at-every-stage-04
  Scenario: Clearing the marker by hand restores normal dispatch, with no residue
    Given role "coder" has a parcel for task "BL-1052-qwen-code-seat" in its inbox
    And the recorded supersede for task "BL-1052-qwen-code-seat" is deleted by hand
    When role "coder" starts a turn
    Then the turn is not refused
    And the parcel for task "BL-1052-qwen-code-seat" is dispatched normally

  # BL-1084 superseded-task-stops-at-every-stage-05
  Scenario Outline: Absence passes, unreadability refuses — they are different answers
    Given the supersede marker store is <store_state>
    And role "coder" has a parcel for task "BL-1099-unrelated" in its inbox
    When role "coder" starts a turn
    Then the turn is <outcome>

    Examples:
      | store_state | outcome     |
      | absent      | not refused |
      | unreadable  | refused     |

  # BL-1084 superseded-task-stops-at-every-stage-06
  Scenario: The guard runs before dispatch chooses task or batch mode
    Given role "cleaner" receives work in batch mode
    And role "cleaner" has a parcel for task "BL-1052-qwen-code-seat" in its inbox
    When role "cleaner" starts a turn
    Then the turn is refused
    And no batch is assembled
