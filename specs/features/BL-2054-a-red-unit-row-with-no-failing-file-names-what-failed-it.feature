Feature: BL-2054 A red unit row with no failing file names what failed it

  QA's gather (qa-gather.js) joins every failing test file of a red unit or
  property run to the standing-red register. When the run names no failing
  file, the join lists the check as unidentified, and QA finds out by hand
  why the lane exited 1. Three times between 2026-10-03 and 2026-10-06 the
  reason was printed in the run's own output: vitest's unhandled
  onTaskUpdate timeout, the per-file budget guard's refusal, or the suite
  work ratchet's refusal. After this parcel a red unit row that names no
  failing file lists each of those causes it printed, with the lane's own
  line for it. A run that printed none of them is still unidentified, and
  the property lane, which ignores unhandled errors, is unchanged.

  # BL-2054 a-red-unit-row-names-its-exit-cause-01
  Scenario Outline: a red unit row that names no failing file lists the cause its output printed
    Given a unit run that exits 1, prints no FAIL line, and prints <exit cause>
    When the gather builds the register join
    Then the join lists the unit check with cause <cause> and the lane's line for it

    Examples:
      | exit cause                                         | cause           |
      | vitest's unhandled onTaskUpdate timeout            | unhandled-error |
      | the file budget guard's refusal of one new pole    | file-budget     |
      | the suite work ratchet's REFUSED verdict           | work-ratchet    |

  # BL-2054 two-causes-are-both-listed-02
  Scenario: a red unit row whose output printed two causes lists both
    Given a unit run that exits 1, prints no FAIL line, and prints vitest's unhandled onTaskUpdate timeout and the file budget guard's refusal of one new pole
    When the gather builds the register join
    Then the join lists the unit check with cause unhandled-error and with cause file-budget

  # BL-2054 a-named-failing-file-gets-no-cause-03
  Scenario: a red unit row that names a failing file lists the file and no cause
    Given a unit run that exits 1, prints a FAIL line for test/brokenThing.test.js, and prints the file budget guard's refusal of one new pole
    When the gather builds the register join
    Then the join lists extension/test/brokenThing.test.js and no cause entry

  # BL-2054 the-property-lanes-ignored-errors-are-no-cause-04
  Scenario: a red properties row whose only error is the ignored onTaskUpdate timeout stays unidentified
    Given a properties run that exits 1, prints no FAIL line, and prints vitest's unhandled onTaskUpdate timeout
    When the gather builds the register join
    Then the join lists the properties check as unidentified and no cause entry
