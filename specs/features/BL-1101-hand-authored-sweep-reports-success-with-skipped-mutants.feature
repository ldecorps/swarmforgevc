Feature: a hand-authored mutation sweep never reports success while a mutant went unrun

  swarmforge/scripts/test/expedite_mutation_sweep.sh is the hardening gate for
  expedite_lib.bb, a Babashka library no wired mutation tool can see. It applies
  each mutant by replacing a literal fragment of the library; when that fragment
  is absent the mutant is skipped, counted, and the run carries on. The run's
  only failure branch reads the survivor list, so a sweep with skipped mutants
  prints ALL MUTANTS KILLED and exits zero - a gate certifying behaviour it
  never exercised. A skipped mutant is not a mild kill: it produces no evidence
  at all, so it must fail the run exactly as a survivor does, and the run must
  name which mutants did not run so their anchors can be repaired against the
  rewritten code.

  Background:
    Given a fixture library, its suites, and a sweep whose mutants target that library

  # BL-1101 sweep-skip-fails-01
  Scenario: a sweep whose mutants all run and all die reports success
    Given every mutant's anchor is present in the library
    When the sweep runs
    Then the sweep exits zero and reports ALL MUTANTS KILLED

  # BL-1101 sweep-skip-fails-02
  Scenario Outline: any mutant that did not die fails the run
    Given <situation>
    When the sweep runs
    Then the sweep exits non-zero and does not report ALL MUTANTS KILLED

    Examples:
      | situation                                                     |
      | one mutant's anchor is absent from the library                |
      | one mutant survives both suites                               |
      | one mutant's anchor is absent and a different mutant survives |

  # BL-1101 sweep-skip-fails-03
  Scenario: the run names every mutant that did not run
    Given two mutants' anchors are absent from the library
    When the sweep runs
    Then the sweep names both unrun mutants by label

  # BL-1101 sweep-skip-fails-04
  Scenario: a failing run leaves the library exactly as it found it
    Given one mutant's anchor is absent and the library carries an uncommitted edit
    When the sweep runs
    Then the sweep exits non-zero and the library still carries the uncommitted edit
