Feature: A mutant that will not finish is killed and reported, never left to pin a worker
  The Gherkin mutation harness runs each mutant to completion and waits. There is
  no ceiling anywhere in it: `grep -n 'timeout|terminate|deadline|AbortController'`
  over `specs/pipeline/mutationWorker.js` and `specs/pipeline/gherkinMutation*.js`
  returns nothing but one unrelated error string.

  So a mutant that hangs - for any reason, not only the leaked-resource one that
  surfaced this - occupies its worker until someone notices and kills the run by
  hand. Measured 2026-09-03: a single mutant held a worker for 808 seconds.

  A hang is also indistinguishable from slow progress while it is happening,
  which is what makes the missing ceiling expensive: the hardener cannot tell a
  wedged run from a long one without waiting out the difference.

  Background:
    Given a mutation run with a per-mutant time ceiling

  # BL-1358 mutant-killed-and-reported-01
  Scenario: a mutant that exceeds the ceiling is killed
    Given a mutant whose scenario never terminates
    When the mutation run reaches it
    Then that mutant is killed once the ceiling elapses
    And its worker is free for the next mutant

  # BL-1358 mutant-killed-and-reported-02
  Scenario: a killed mutant is reported as its own outcome, not as killed-by-the-suite
    Given a mutant whose scenario never terminates
    When the mutation run reaches it
    Then the run's outcome for that mutant is distinguishable from a mutant the tests detected
    And the report names the mutant and the ceiling it exceeded

  # BL-1358 mutant-killed-and-reported-03
  Scenario: the run completes and stays useful when one mutant times out
    Given a mutation run in which exactly one mutant never terminates
    When the run finishes
    Then every other mutant carries its ordinary outcome

  # BL-1358 mutant-killed-and-reported-04
  Scenario: a mutant that finishes within the ceiling is untouched
    Given a mutant whose scenario finishes well inside the ceiling
    When the mutation run reaches it
    Then its outcome is whatever the tests decided
    And nothing was killed
