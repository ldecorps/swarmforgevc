# mutation-stamp: sha256=311c65814d5fd7559c5f1dd8c1755d29dbbe12e5e6add07ddacc5de93cb07365
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-22T20:15:25.282036677Z","feature_name":"BL-1066 a metrics poll tick never stacks on one still running","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1066-metrics-poll-tick-restarts-a-102-second-git-walk.feature","background_hash":"74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b","implementation_hash":"unknown","scenarios":[{"index":1,"name":"the cost of one computation does not grow with the corpus","scenario_hash":"55360590f40e324a3c400c2951cd8f3dee7a83a5caf98db645da82d87dc63980","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-08-22T20:15:25.282036677Z"}]}
# acceptance-mutation-manifest-end

Feature: BL-1066 a metrics poll tick never stacks on one still running
  The panel recomputes swarm metrics on a 2-second poll tick, and that
  computation walks every closed ticket with its own rename-following
  `git log --follow`. At the current corpus that is ~794 walks of ~0.128s each,
  roughly 102 seconds of git per tick - scheduled every 2 seconds. Ticks
  therefore overlap without bound, which is the storm of parallel git children
  and defunct processes observed on the host. Cost must stop growing with the
  number of closed tickets, and a tick must never re-enter a computation that
  is still running.

  # BL-1066 metrics-tick-no-stacking-01
  Scenario: a tick arriving mid-computation does not start a second one
    Given a metrics computation is already in flight
    When the next poll tick fires
    Then no second computation is started
    And the number of git children in flight does not increase

  # BL-1066 metrics-tick-no-stacking-02
  Scenario Outline: the cost of one computation does not grow with the corpus
    Given a target repo with <done-tickets> closed tickets
    When metrics are computed once
    Then the number of git subprocesses spawned stays within the declared bound

    Examples:
      | done-tickets |
      | 10           |
      | 800          |

  # BL-1066 metrics-tick-no-stacking-03
  Scenario: no git child is left unreaped
    When metrics are computed once
    Then every git child the computation spawned has been reaped
    And no defunct git process remains

  # BL-1066 metrics-tick-no-stacking-04
  Scenario: the metric is still correct, not merely cheap
    Given a target repo whose closed tickets have known active-to-done durations
    When metrics are computed once
    Then the reported mean ticket time matches those known durations
    And the reported sample count matches the number of closed tickets
