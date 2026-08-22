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
