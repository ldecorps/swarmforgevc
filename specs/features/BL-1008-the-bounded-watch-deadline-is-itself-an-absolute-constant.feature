# mutation-stamp: sha256=8b35fa486dddf52784d1848ed309f171de3bbd333de94a493d4197e2f2a057dc
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T14:21:04.746191982Z","feature_name":"The bounded fs.watch deadline follows recorded contention","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1008-the-bounded-watch-deadline-is-itself-an-absolute-constant.feature","background_hash":"61e3eb59ce58a83cc1312c4fb5ac8d6abcb06528b50dd4c29f11e1aaf4aff062","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the deadline follows the recorded contention factor","scenario_hash":"feb009e5678cdec8d018bc68ef2bacc95251acac051d2a6bc17bcd3893ab9883","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:21:04.746191982Z"},{"index":1,"name":"the deadline stays strictly below the test's effective budget","scenario_hash":"416dd0b8569e9bdc0a639966ae7b64f3f763141b02b7e0fa512d5ad413f259f5","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T14:21:04.746191982Z"}]}
# acceptance-mutation-manifest-end

Feature: The bounded fs.watch deadline follows recorded contention

  BL-933 raced a real fs.watch event against a short explicit deadline so a
  missing OS event fails fast with a readable message instead of consuming
  the whole lane budget. These scenarios keep that diagnostic while removing
  the bare constant the deadline was expressed as.

  Background:
    Given a bounded wait on a real fs.watch event

  # BL-1008 bounded-watch-deadline-01
  Scenario Outline: the deadline follows the recorded contention factor
    When the recorded contention factor is <factor>
    Then the bounded wait deadline is <deadline> ms

    Examples:
      | factor   | deadline |
      | 0.25     | 10000    |
      | 1        | 10000    |
      | 3        | 30000    |
      | unusable | 10000    |

  # BL-1008 bounded-watch-deadline-02
  Scenario Outline: the deadline stays strictly below the test's effective budget
    When the recorded contention factor is <factor>
    Then the bounded wait deadline is less than the test's effective budget

    Examples:
      | factor |
      | 1      |
      | 3      |
      | 1000   |

  # BL-1008 bounded-watch-deadline-03
  Scenario: a missing event still names the event and the watched path
    When the awaited event never arrives
    Then the failure message names the event label
    And the failure message names the watched path
