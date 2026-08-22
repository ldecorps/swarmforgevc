Feature: rotating a pane into a parcel's own owner is not abandonment

  # BL-926 (swarm-reliability). The resident-invoked rotate gate
  # (rotate_to_role.bb -> handoff-lib/respawn-as! ->
  # mono-router-lib/rotate-gate-decision) refuses whenever the departing role's
  # in_process box holds a real *.handoff parcel. Its entire input is
  # {:blocking-file :force?}, so it cannot see which role is being rotated TO.
  # When departing role and target are the same role it still refuses, even
  # though rotating a pane INTO the owner of a parcel abandons nothing — it is
  # the only way that parcel gets picked up.
  #
  # The boundary this pins is OWNERSHIP, not presence: a parcel sitting in some
  # role's box is never on its own enough to refuse. Refusal is reserved for a
  # departure that would actually strand work the departing pane itself claimed.
  #
  # Step handlers: specs/pipeline/steps/bl926RotateGateOwnerSteps.js, driving
  # the gate against fixture mono-router layouts. The <box> and <decision>
  # columns are validated against explicit KNOWN_VALUES, never passed through.

  Background:
    Given a mono-router pack whose single resident pane serves every role in turn

  # BL-926 rotate-gate-owner-01
  Scenario Outline: the gate decides from ownership rather than from a parcel merely being present
    Given the active-role marker names "<departing>"
    And that role's in_process box holds <box>
    When the resident invokes rotation to "<target>"
    Then the rotate gate decision is "<decision>"

    Examples:
      | departing | target     | box              | decision |
      | coder     | coder      | a real parcel    | proceed  |
      | coder     | documenter | a real parcel    | refuse   |
      | coder     | documenter | no parcel        | proceed  |
      | coder     | documenter | a sidecar only   | proceed  |

  # BL-926 rotate-gate-owner-02
  Scenario: the parcel survives a rotation into its own owner and is resumed there
    Given the active-role marker names "coder"
    And that role's in_process box holds a real parcel
    When the resident invokes rotation to "coder"
    Then the rotate gate decision is "proceed"
    And that role's in_process box still holds the same parcel unchanged
    And that role's next receive resumes the parcel rather than reporting no task

  # BL-926 rotate-gate-owner-03
  Scenario: the force override still rotates over a genuinely abandoned parcel
    Given the active-role marker names "coder"
    And that role's in_process box holds a real parcel
    And the rotate force override is set
    When the resident invokes rotation to "documenter"
    Then the rotate gate decision is "proceed-forced"
    And the warning names the parcel left behind
