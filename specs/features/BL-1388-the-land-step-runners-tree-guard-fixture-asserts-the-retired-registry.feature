# mutation-stamp: sha256=0e22921bf602cee23874edaef715abaefa3eb17684ec2013c6051fbd20e67ecb
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-04T20:59:18.057771760Z","feature_name":"BL-1388 The land-step runner's tree-guard fixture describes the guard as it stands","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1388-the-land-step-runners-tree-guard-fixture-asserts-the-retired-registry.feature","background_hash":"8a6109dbc3e7b64ab46ddfcf8319b0c7a18e5e8ee84653f20bfde5768e2673d8","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the real tree guard refuses a handler discovery cannot reach","scenario_hash":"38d9c314b56a44318662f2c915548c43d4a028031a144e1fa3d0f4287dea9b55","mutation_count":1,"result":{"Total":1,"Killed":1,"Survived":0,"Errors":0},"tested_at":"2026-09-04T20:59:18.057771760Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1388 The land-step runner's tree-guard fixture describes the guard as it stands

  The land-step runner pins that a tip-pure replay really reaches the
  feature-handler registration guard on a non-main tree. Its fixture builds
  the refusal case with a hand-written registry array that lists no handler,
  which was unregistered under the hand-maintained array and is registered
  under discovery. The guard is right and the runner has been red since
  discovery landed. This feature is that the runner is green, that its
  refusal case is a handler discovery cannot reach, and that a discoverable
  handler beside an empty array is not refused.

  Background:
    Given a scratch tree on a land-replay branch with a feature file and one handler

  # BL-1388 the-runner-is-green-01
  Scenario: the land-step runner passes on main
    When the land-step test runner runs
    Then it exits zero with no failing assertion

  # BL-1388 an-undiscoverable-handler-is-refused-02
  # Row "nested in a subdirectory of the steps directory" RETIRED 2026-09-04
  # (never reworded): the guard lists the steps directory flat, so a nested
  # handler is never seen and never refused - that hole is BL-1400's.
  Scenario Outline: the real tree guard refuses a handler discovery cannot reach
    Given the handler is <placement>
    When the replayed tree guards run against the scratch tree
    Then the guards refuse
    And the refusal names the feature file

    Examples:
      | placement                                       |
      | named without the Steps.js suffix               |

  # BL-1388 moving-it-into-reach-clears-the-refusal-03
  # RETIRED 2026-09-04 (never reworded): its premise was a nested handler,
  # which the guard never sees (BL-1400). Replaced by 05.

  # BL-1388 a-discoverable-handler-beside-an-empty-array-passes-04
  Scenario: a discoverable handler beside an empty registry array is not refused
    Given the handler is at the top of the steps directory
    And the tree carries a registry file whose array lists no handler
    When the replayed tree guards run against the scratch tree
    Then the replayed tree guards pass

  # BL-1388 renaming-it-into-reach-clears-the-refusal-05
  Scenario: renaming the handler with the discovery suffix clears the refusal
    Given the handler is named without the Steps.js suffix
    And the replayed tree guards refused the scratch tree
    When the handler is renamed with the Steps.js suffix
    Then the replayed tree guards pass
