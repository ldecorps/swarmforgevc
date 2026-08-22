Feature: the aged-note rotate wiring fixture declares a rotation-router pack

  # BL-938 (swarm-reliability). test_handoffd_aged_note_rotate_wiring.sh
  # drives the REAL handoffd chase sweep against a disposable fixture,
  # asserting that a note aged past note_actionable_after_ms rotates the
  # resident to the dormant recipient role (the BL-576 aged-note
  # actionability behaviour).
  #
  # BL-931 added an EARLIER gate in that same call path: rotation is
  # refused outright on a pack that is not declared a rotation router.
  # This fixture's setup_common_fixture never declares a pack topology, so
  # it now reads as non-router and every rotation is refused before it
  # reaches the behaviour the test exists to prove. Measured 2026-08-19:
  # Scenario A fails with "the resident was never rotated to specifier for
  # its aged note", and the daemon log carries chase-rotate-error cleaner
  # not-a-rotation-router twice.
  #
  # Its two siblings already carry the declaration
  # (test_handoffd_priority_rotate_wiring.sh writes it twice,
  # test_handoffd_starve_rotate_wiring.sh once) and both pass; the sibling
  # shell fixture test_rotate_to_role_stuck_parcel_gate.sh took exactly
  # this amendment when BL-931 landed. This one file was missed because it
  # could not run at all - it died on `mapfile: command not found` at line
  # 132 on a stock bash 3.2 host, long before reaching the pack gate.
  # BL-937's port made it executable, which is what surfaced this.
  #
  # Step handlers drive the same real handoffd sweep the shell test drives,
  # never a reimplementation of the gate.
  #
  # The router declaration sits in the Background because three of the four
  # scenarios share it; scenario 04 is the deliberate negative case and
  # says so by removing it, which is why this feature carries no Scenario
  # Outline over a <topology> column - two rows, one of them an override of
  # the shared setup, read clearer as two named scenarios.

  Background:
    Given a handoffd fixture whose mailboxes hold a note for a dormant role, aged past note_actionable_after_ms
    And the fixture pack declares that it rotates

  # BL-938 aged-note-rotate-fixture-declares-a-rotation-router-01
  Scenario: the aged-note rotate wiring test is green
    When the aged-note rotate wiring test is run
    Then every one of its scenarios passes
    And no failure cites a refusal to rotate the pack

  # BL-938 aged-note-rotate-fixture-declares-a-rotation-router-02
  Scenario: the aged note rotates the resident to its recipient role
    When the handoffd chase sweep runs
    Then the daemon log records a rotation to the note's recipient role

  # BL-938 aged-note-rotate-fixture-declares-a-rotation-router-03
  Scenario: the restored test still fails when the aged-note behaviour is neutralised
    Given aged-note actionability is neutralised so no note ever ages in
    When the aged-note rotate wiring test is run
    Then the test fails

  # BL-938 aged-note-rotate-fixture-declares-a-rotation-router-04
  Scenario: a pack with no declared topology still refuses the rotation
    Given the pack declaration is removed from the fixture
    When the handoffd chase sweep runs
    Then the daemon log records a not-a-rotation-router refusal
    And the resident is not rotated
