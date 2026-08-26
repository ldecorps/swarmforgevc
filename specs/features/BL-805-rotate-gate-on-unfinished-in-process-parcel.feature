Feature: BL-805 resident-invoked rotation is gated on a drained in_process box

  The pack prompts now require done_with_current.sh before rotate_to_role.sh,
  but prompt text alone trusts the model to reach the last line of its
  checklist. The rotation entry the resident invokes must refuse to rotate
  while the departing role still holds an unfinished parcel — otherwise the
  parcel ages into the babysitter's stuck-in-process WARN and is falsely
  resumed on the next rotation back into that role. Daemon-initiated
  rotation is a different, deliberately ungated path: blocking it could
  strand the whole swarm on the very parcel it is trying to drain.

  Background:
    Given a fixture project root with a .swarmforge directory
    And the active-role marker names a departing role with a mailbox

  # BL-805 rotate-gate-on-unfinished-in-process-parcel-01
  Scenario: rotation is refused while the departing role holds an unfinished parcel
    Given the departing role's inbox in_process contains a handoff file
    When the resident invokes the rotation entry
    Then the rotation is refused with a nonzero exit
    And the refusal names done_with_current.sh as the required step
    And the pane is not respawned

  # BL-805 rotate-gate-on-unfinished-in-process-parcel-02
  Scenario: rotation proceeds when the departing role's in_process box is empty
    Given the departing role's inbox in_process contains no files
    When the resident invokes the rotation entry
    Then the rotation proceeds

  # BL-805 rotate-gate-on-unfinished-in-process-parcel-03
  Scenario: sidecar droppings alone never block rotation
    Given the departing role's inbox in_process contains only a claim-progress sidecar file
    When the resident invokes the rotation entry
    Then the rotation proceeds

  # BL-805 rotate-gate-on-unfinished-in-process-parcel-04
  Scenario: daemon-initiated rotation is never gated on a stuck parcel
    Given the departing role's inbox in_process contains a handoff file
    When the handoff daemon rotates the resident through its own rotation path
    Then the rotation proceeds

  # BL-805 rotate-gate-on-unfinished-in-process-parcel-05
  Scenario: an explicit force override rotates anyway with a loud warning
    Given the departing role's inbox in_process contains a handoff file
    And the rotation force override is set
    When the resident invokes the rotation entry
    Then the rotation proceeds
    And a warning names the stuck parcel left behind
