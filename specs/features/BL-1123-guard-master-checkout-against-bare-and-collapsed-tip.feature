# mutation-stamp: sha256=d615217e473056d21258af22347a7e379cd1b8e7c43d8dcc5839f53560b0b88d
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T10:21:19.990418369Z","feature_name":"BL-1123 guard master checkout against bare and collapsed tip","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1123-guard-master-checkout-against-bare-and-collapsed-tip.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"tip-floor guard allows full trees and blocks tiny ones","scenario_hash":"183aeb04cbeb91add9ae00543ccfd6ec3e3b7822495d0ae60bdeb838a7d37131","mutation_count":4,"result":{"Total":4,"Killed":4,"Survived":0,"Errors":0},"tested_at":"2026-08-25T10:21:19.990418369Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1123 guard master checkout against bare and collapsed tip
  The master checkout must stay a usable work tree with a full tip.
  core.bare=true and tip collapses to tiny trees are swarm-down class.

  # BL-1123 bare-true-healed-or-alarmed-01
  Scenario: a master checkout with core.bare=true is healed or blocked loudly
    Given a fixture git repo whose config has core.bare set to true
    When the master-checkout bare guard runs against that repo
    Then core.bare is false afterward or the guard exits non-zero with a bare-checkout alarm
    And git rev-parse --is-inside-work-tree reports true after a successful heal

  # BL-1123 tip-floor-02
  Scenario Outline: tip-floor guard allows full trees and blocks tiny ones
    Given a fixture repo whose main tip already has a full file-count tree
    And a candidate commit whose tree size is <size>
    When the tip-floor guard evaluates moving main to that candidate
    Then the move is <verdict>
    And HEAD still lists at least the configured safe number of paths

    Examples:
      | size                 | verdict                                      |
      | below the safe floor | refused or restored to the last full tip     |
      | a full file-count    | allowed                                      |
