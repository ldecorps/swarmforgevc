Feature: BL-1349 The slowest spawn-heavy property files fit a per-file budget

  The property lane's wall clock can never fall below its single longest
  file, so no fork count shortens a lane whose worst file runs for 79
  seconds. Three files spawn real processes inside a sampled property and
  dominate that tail. This feature is that each fits a per-file budget with
  its properties intact - reducing samples of a spawn, never deleting a
  property or weakening what it asserts.

  Background:
    Given the property lane runs from the extension directory

  # BL-1349 spawn-heavy-file-fits-budget-01
  Scenario Outline: a spawn-heavy property file completes within the per-file budget
    Given the property file <file>
    When it is run alone in the property lane
    Then it completes within 15 seconds
    And it reports no failing test

    Examples:
      | file                                                    |
      | onboarderLauncherPidGuard.property.test.js              |
      | bl1252CommitGuardAggregationInvariants.property.test.js |
      | bl787NamedTunnelInvariants.property.test.js             |

  # BL-1349 no-property-is-dropped-02
  Scenario: no property is deleted to meet the budget
    Given the three tuned property files
    When their properties are compared with the parent commit
    Then every property present before is still present
