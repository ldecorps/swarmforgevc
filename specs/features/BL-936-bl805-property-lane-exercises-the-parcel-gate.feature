Feature: the BL-805 rotation-gate property lane exercises the parcel gate, not the pack gate

  # BL-936 (swarm-reliability). BL-805's two properties drive the REAL
  # rotate_to_role.sh and handoff-lib/rotate-resident-to! against a
  # disposable fixture, asserting that only a real *.handoff parcel in the
  # departing role's in_process box gates resident-invoked rotation, and
  # that the daemon path is never gated at all.
  #
  # BL-931 then added an EARLIER gate in the same call path: rotation is
  # refused outright on a pack that is not a rotation router. BL-805's
  # fixture never declared a pack topology, so it now reads as non-router
  # and both properties are refused before they reach the gate they exist
  # to test. Measured 2026-08-19: 2 of 2 tests fail on the first shape
  # ("empty") - the daemon path returns {:ok false :reason
  # not-a-rotation-router} and the resident path exits 6 with "this pack
  # does not rotate".
  #
  # The sibling shell fixture test_rotate_to_role_stuck_parcel_gate.sh took
  # exactly this amendment when BL-931 landed (it writes a rotation router
  # line into its fixture conf, with a comment saying why). The property
  # lane is a separate command that BL-931's gates never ran, so this one
  # file was missed. This ticket gives it the same amendment.
  #
  # Step handlers drive the same real helpers the property file drives -
  # never a reimplementation of either gate. The <entry>, <contents> and
  # <outcome> columns are validated against explicit KNOWN_VALUES, never
  # passed through.

  # BL-936 bl805-property-lane-exercises-the-parcel-gate-01
  Scenario: the BL-805 rotation-gate property file is green on the property lane
    Given the BL-805 rotation-gate property file
    When it is run on the property lane
    Then both of its properties pass
    And no failure cites a refusal to rotate the pack

  # BL-936 bl805-property-lane-exercises-the-parcel-gate-02
  Scenario Outline: the unfinished-parcel gate decides each rotation entry
    Given a BL-805-shaped rotation fixture whose pack declares that it rotates
    And the departing role's in_process box holds <contents>
    When rotation is driven through the <entry> entry
    Then the rotation <outcome>

    Examples:
      | entry            | contents                 | outcome                                 |
      | resident-invoked | a real unfinished parcel | is refused, naming done_with_current.sh |
      | resident-invoked | only sidecars and junk   | proceeds and respawns the pane          |
      | daemon           | a real unfinished parcel | proceeds and respawns the pane          |
