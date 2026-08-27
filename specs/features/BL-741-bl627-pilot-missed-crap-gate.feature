Feature: pilot land gate always runs scoped CRAP separate from mutation_cost low

  # BL-741: BL-627 landed collectReferencedClaudeModels at CRAP=10.89 with no CRAP
  # pass — mutation_cost low likely skipped the hardener-equivalent step. CRAP is a
  # separate always-run gate scoped to touched files; it is never bundled under the
  # same low-cost exemption as mutation testing. Companion code gap: BL-740.

  Background:
    Given a piloted ticket whose declared acceptance contract has just passed

  # BL-741 low-mutation-cost-runs-crap-01
  Scenario: a ticket with mutation_cost low still runs the CRAP gate on touched files at land
    Given the ticket yaml declares mutation_cost low
    And the run's commits touched TypeScript files under extension/
    When the pilot runs the landing gate
    Then the CRAP gate runs scoped to those touched files
    And mutation_cost low does not skip the CRAP gate

  # BL-741 crap-violation-refuses-02
  Scenario: a CRAP violation on a touched new function refuses the land
    Given the run's commits added a function with CRAP greater than six on a touched file
    When the pilot runs the landing gate
    Then the land is refused for CRAP violation
    And the refusal names the file and function

  # BL-741 hardener-prompt-separates-03
  Scenario: hardener guidance treats CRAP as separate from mutation_cost exemptions
    When the hardener role prompt is read
    Then it states CRAP is an always-run gate scoped to changed files
    And it states mutation_cost low does not exempt CRAP from pilot or pipeline land

  # BL-741 crap-pass-continues-04
  Scenario: scoped CRAP passing on touched files does not block land by itself
    Given the run's commits touched files whose functions are all at CRAP six or below
    When the pilot runs the landing gate
    Then the CRAP gate completes without refusal
    And other landing gates may still refuse or complete independently

  # BL-741 refused-crap-no-durable-05
  Scenario: a refused CRAP land writes nothing durable
    Given the run's commits touched a file with a CRAP violation
    When the pilot runs the landing gate
    Then the land is refused for CRAP violation
    And the ticket yaml stays where it was
    And no acceptance receipt is written
