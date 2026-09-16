Feature: BL-1554 QA gathers its mechanical checklist in one call

  QA's pass routine repeats the same always-identical mechanical checks by
  hand on every parcel, each as its own ad-hoc shell command: the straggler
  process check, the sibling-deferral status, the standing-red register
  lookup, the pre-QA wiring gate, the unit suite, the property lane, the
  ticket's acceptance run. This feature is one CLI that runs that fixed
  checklist in its fixed order and prints one structured report of what
  each check ran, how it exited and what it printed - and nothing more. It
  gathers and reports only; it never renders pass or bounce, so QA still
  reads the report and judges pre-existing red against new, owned against
  unowned, bounce against approve. BL-1362's record-review-evidence.js is
  the precedent: the same hand-made ritual replaced by a deterministic tool
  that records what it is given and decides nothing.

  Background:
    Given a fixture repository with a ticket BL-1554-FIX in backlog/active whose acceptance names one feature file
    And a fake check runner that records every command it is asked to start and answers from a script

  # BL-1554 qa-gathers-checklist-01
  Scenario: the report lists the fixed checklist in its fixed order
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the report names the checks stragglers_before, sibling, register, wiring, unit, properties, acceptance, stragglers_after in that order
    And every check row carries the command it ran, its working directory, its exit status and an output excerpt
    And the tool exits 0

  # BL-1554 qa-gathers-checklist-02
  Scenario Outline: a check's exit status and output are reported, never judged
    Given the fake runner answers the unit check with exit <exit> and the output "<output>"
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the unit check row reports exit <exit> and an excerpt containing "<output>"
    And the report carries no verdict field and none of the words pass, bounce or approve as a value
    And the tool exits 0

    Examples:
      | exit | output                              |
      | 0    | 2412 passed                         |
      | 1    | 3 failed  bl1364TurnProfileSeries   |
      | 3    | DEFERRED BL-1554-FIX BLOCKED_BY x   |

  # BL-1554 qa-gathers-checklist-03
  Scenario: a check whose command cannot start is reported blocked and the rest still run
    Given the fake runner cannot start the sibling check because its command is missing
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the sibling check row reports status blocked with the reason the runner gave
    And the register, wiring, unit, properties, acceptance and stragglers_after checks were still started
    And the tool exits 0

  # BL-1554 qa-gathers-checklist-04
  Scenario: the checks run one after another, never concurrently
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the fake runner's log shows every check started only after the previous check had ended

  # BL-1554 qa-gathers-checklist-05
  Scenario Outline: a failing test file named by a suite is joined to the standing-red register
    Given the fake runner answers the properties check with exit 1 and an output naming the failing file <file>
    And the register check answers with a row for <file> that is <row>
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the report's register join lists <file> as <join>

    Examples:
      | file                                       | row                     | join     |
      | extension/test/owned.property.test.js      | owned by BL-1553        | owned    |
      | extension/test/stale.property.test.js      | naming a closed ticket  | unowned  |
      | extension/test/fresh.property.test.js      | absent from the register| absent   |

  # BL-1554 qa-gathers-checklist-06 (QA bounce D1, 2026-09-16)
  Scenario: a bare unit/properties vitest path is still joined to the register's extension/-relative row
    Given the fake runner answers the properties check with exit 1 and an output naming the bare failing file test/bl1606example.property.test.js
    And the register check answers with a row for extension/test/bl1606example.property.test.js that is owned by BL-1606
    When qa-gather runs for BL-1554-FIX over the fake runner
    Then the report's register join lists extension/test/bl1606example.property.test.js as owned
