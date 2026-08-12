Feature: Gherkin mutation runner rejects bad arguments before any mutant runs

  # BL-884: run_gherkin_mutation.sh validates neither its steps-module nor
  # its level positional. A mis-ordered call that puts the level in the
  # steps-module slot makes every mutant crash MODULE_NOT_FOUND, and the
  # crash counts as a kill - a false-clean manifest with zero real
  # assertions run (BL-715 near-miss, 2026-08-12). The runner must fail
  # loud on a nonexistent steps module or an unrecognized level, write no
  # manifest on rejection, and leave valid calls byte-identical in
  # behavior.

  Background:
    Given a scratch work directory for a gherkin mutation run

  # BL-884 bad-argument-rejected-01
  Scenario Outline: an invalid optional positional is rejected before any mutant runs
    When the gherkin mutation runner is invoked with the <slot> argument set to "<bad_value>"
    Then the runner exits non-zero naming the <slot> argument
    And no mutation manifest is written under the work directory

    Examples:
      | slot         | bad_value          |
      | steps-module | hard               |
      | steps-module | ./no/such/steps.js |
      | level        | bogus              |

  # BL-884 valid-call-unchanged-02
  Scenario: a correct four-positional call keeps the established exit-code contract
    When the gherkin mutation runner is invoked with all four positionals valid
    Then the runner exit code is one of the established codes 0, 1, or 2
