Feature: a zero-mutant Gherkin mutation run never reads as a pass

  # BL-638: run_gherkin_mutation.sh mutates only Examples-table cells inside a
  # Scenario Outline. A feature with no Scenario Outline — a majority of the
  # corpus; 247 of 455 files when this was written, 216 of 356 when the defect
  # was filed, so treat the ratio as the point and never a literal to assert on
  # — generates zero mutants and today exits 0 with
  # "Total 0 | Killed 0 | Survived 0 | Errors 0" — indistinguishable from a
  # clean sweep — and writes a mutation-stamp recording the file as covered on
  # the strength of having proved nothing. This ticket makes a zero-mutant run
  # its own distinct, non-passing outcome that stays non-passing on re-run.
  #
  # Specifier note: this feature file is itself outline-free, deliberately. It
  # is a live instance of the defect, and must report inapplicable rather than
  # be given a token Scenario Outline to dodge the gate.

  # BL-638 zero-mutant-run-is-not-a-pass-01
  Scenario: a feature with no Scenario Outline produces a distinguishable non-pass outcome
    Given a feature file with no Scenario Outline
    When the mutation gate runs against it at the default level
    Then the outcome is reported as inapplicable, not as a pass
    And the exit status is distinguishable from a clean sweep with survivors killed

  # BL-638 stamped-outline-free-rerun-still-inapplicable-02
  Scenario: re-running an already-stamped outline-free feature still reports inapplicable
    Given a feature file with no Scenario Outline that the mutation gate has already run against
    And its feature text is unchanged since that run
    When the mutation gate runs against it again at the default level
    Then the outcome is reported as inapplicable, not as a pass
    And the second run's outcome matches the first run's outcome

  # BL-638 outline-feature-behaves-as-today-03
  Scenario: a feature with a Scenario Outline behaves exactly as today
    Given a feature file with at least one Scenario Outline
    When the mutation gate runs against it at the default level
    Then mutants are generated from its Examples-table cells
    And the outcome is reported as a normal pass or fail, with no new friction

  # BL-638 manifest-never-looks-completed-for-zero-mutants-04
  Scenario: the manifest never records a completed-looking run for zero mutants
    Given a feature file with no Scenario Outline
    When the mutation gate runs against it at the default level
    Then the manifest does not record an empty scenario list beside an unknown implementation hash as if it were a success
    And the manifest marks the run inapplicable

  # BL-638 hardener-prompt-states-fallback-05
  Scenario: the hardener role prompt states what to do when a mutation gate is inapplicable
    Given the hardener role prompt
    When a mutation gate reports an inapplicable outcome for a parcel's code
    Then the prompt names the fallback action to take instead of silently treating it as passed

  # BL-638 real-corpus-fixture-06
  Scenario: the fixture uses a real corpus feature, not a synthetic one
    Given an outline-free feature file already committed under specs/features/
    When the mutation gate runs against it at the default level
    Then the outcome is reported as inapplicable, matching scenario 01

  # BL-638 adding-an-outline-still-re-arms-the-gate-07
  Scenario: adding a Scenario Outline to a stamped outline-free feature still re-arms the gate
    Given a feature file with no Scenario Outline that the mutation gate has already run against
    When a Scenario Outline is added to that feature file
    And the mutation gate runs against it again at the default level
    Then mutants are actually generated on that run
