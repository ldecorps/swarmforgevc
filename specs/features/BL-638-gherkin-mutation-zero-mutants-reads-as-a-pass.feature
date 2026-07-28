Feature: a zero-mutant Gherkin mutation run never reads as a pass

  # BL-638: run_gherkin_mutation.sh mutates only Examples-table cells inside a
  # Scenario Outline. A feature with no Scenario Outline (60% of the corpus,
  # 216/356 files) generates zero mutants and today exits 0 with
  # "Total 0 | Killed 0 | Survived 0 | Errors 0" — indistinguishable from a
  # clean sweep — and writes a suppressing mutation-stamp, so the gate goes
  # permanently silent for that file even after a Scenario Outline is added
  # later. This ticket makes a zero-mutant run its own distinct, non-passing
  # outcome, and stops it from writing a suppressing stamp.

  # BL-638 zero-mutant-run-is-not-a-pass-01
  Scenario: a feature with no Scenario Outline produces a distinguishable non-pass outcome
    Given a feature file with no Scenario Outline
    When the Gherkin mutation gate runs against it at the default level
    Then the outcome is reported as inapplicable, not as a pass
    And the exit status is distinguishable from a clean sweep with survivors killed

  # BL-638 zero-mutant-run-does-not-suppress-later-run-02
  Scenario: a zero-mutant run does not write a stamp that suppresses a later run
    Given a feature file with no Scenario Outline was just run through the mutation gate
    When a Scenario Outline is added to that feature file
    And the mutation gate runs again at the default level
    Then mutants are actually generated on this second run

  # BL-638 outline-feature-behaves-as-today-03
  Scenario: a feature with a Scenario Outline behaves exactly as today
    Given a feature file with at least one Scenario Outline
    When the Gherkin mutation gate runs against it
    Then mutants are generated from its Examples-table cells
    And the outcome is reported as a normal pass or fail, with no new friction

  # BL-638 manifest-never-looks-completed-for-zero-mutants-04
  Scenario: the manifest never records a completed-looking run for zero mutants
    Given a feature file with no Scenario Outline
    When the Gherkin mutation gate runs against it
    Then the manifest does not record scenarios: [] alongside implementation_hash: "unknown" as if it were a success
    And the manifest marks the run inapplicable

  # BL-638 hardener-prompt-states-fallback-05
  Scenario: the hardener role prompt states what to do when a mutation gate is inapplicable
    Given the hardener role prompt
    When a mutation gate reports an inapplicable outcome for a parcel's code
    Then the prompt names the fallback action to take instead of silently treating it as passed

  # BL-638 real-corpus-fixture-06
  Scenario: the fixture uses a real corpus feature, not a synthetic one
    Given one of the 216 outline-free feature files already in specs/features/
    When the Gherkin mutation gate runs against it
    Then the outcome is reported as inapplicable, matching scenario 01
