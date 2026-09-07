# mutation-stamp: sha256=9d631c5f99f0a9fe2c7bbc123f7c858a2bc1ca87527583aa825d22d62c1897f4
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-07T10:21:33.728942776Z","feature_name":"BL-1349 The slowest spawn-heavy property files fit a per-file budget","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1349-spawn-heavy-property-files-fit-a-budget.feature","background_hash":"8fc726aa12018619be8b6b1bd5c9dd73029a4470327a295189f84d52c048d6f2","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a spawn-heavy property file completes within the per-file budget","scenario_hash":"3e7302f7d8faebda523318a9261c0fdea57e4b85315c062cad304e47fcf1218b","mutation_count":7,"result":{"Total":7,"Killed":7,"Survived":0,"Errors":0},"tested_at":"2026-09-07T10:21:33.728942776Z"}]}
# acceptance-mutation-manifest-end

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
      | file                                                      |
      | onboarderLauncherPidGuard.property.test.js                |
      | bl1252IndexGuardsAllRunInvariant.property.test.js         |
      | bl1252ViolatingGuardsAllNamedInvariant.property.test.js   |
      | bl1252RefusalPredicateUnchangedInvariant.property.test.js |
      | bl1252ExpensiveGuardTieringInvariant.property.test.js     |
      | bl1252UnexpectedFailureNeverPassesInvariant.property.test.js |
      | bl787NamedTunnelInvariants.property.test.js               |

  # BL-1349 no-property-is-dropped-02
  Scenario: no property is deleted to meet the budget
    Given the three tuned property files
    When their properties are compared with the parent commit
    Then every property present before is still present
