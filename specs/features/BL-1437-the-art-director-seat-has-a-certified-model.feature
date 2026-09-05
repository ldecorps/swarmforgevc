Feature: BL-1437 The art-director seat has a certified model

  BL-1418 makes the Art Director a real seat: a window in the full-forge
  pack running claude-sonnet-5, a worktree, a mailbox, a topic, and a name
  in every swarm-role list including the model factory's. The factory
  resolves a seat's model through the Model Steward's role matrix
  (models.seed.json role_matrix), which ranks certified candidates per role
  with an evidence pointer each; a role with no row is simply absent from
  assign-swarm's answer, and pack_staffing_gate_lib.bb refuses to launch a
  seat whose model is not on its role's matrix. The new seat has no row, so
  the factory cannot assign it and the pack launches only under the
  operator escape hatch. A row is a certification, the steward's own
  contract, recorded from real review evidence; no parcel may fabricate one.

  This feature is that the art-director role has a certified model on its
  matrix with an evidence pointer that resolves to a recorded scorecard and
  a certification report, that the factory assigns the seat in both modes,
  and that the staffing gate admits the seat's pack line on its own merits.
  Scenarios 01 and 04 read the parcel's own committed seed and artifacts, a
  read-only live-tree read justified because they are the contract at this
  commit; scenarios 02 and 03 run the real CLIs against a fixture state
  directory seeded from that file, never the live steward state.

  Background:
    Given the Model Steward registry seeded from the parcel's own models.seed.json into a fixture state directory

  # BL-1437 the-role-matrix-has-a-certified-row-01
  Scenario: the art-director role matrix carries a certified model with resolvable evidence
    When the art-director row of the role matrix is read
    Then it names a provider and model whose registry status is certified
    And its evidence pointer resolves to a scorecard artifact committed in the repository

  # BL-1437 the-factory-assigns-the-seat-02
  Scenario Outline: the model factory assigns the art-director seat under both steering modes
    When the model factory resolves the full swarm assignment in <mode> mode
    Then the assignment names art-director with a certified model and a launch agent

    Examples:
      | mode    |
      | quality |
      | cheap   |

  # BL-1437 the-staffing-gate-admits-the-seat-03
  Scenario: the pack staffing gate admits the art-director window line without the escape hatch
    When the staffing gate evaluates the full-forge pack's art-director window line
    Then its decision for that seat is not refuse
    And no check reports the seat as not on the role matrix

  # BL-1437 the-certification-is-recorded-04
  Scenario: the certification report artifact records the role, the model and the scorecard
    When the certification report for the art-director model is read
    Then it names the role, the provider and model, the scorecard it rests on, and the date
