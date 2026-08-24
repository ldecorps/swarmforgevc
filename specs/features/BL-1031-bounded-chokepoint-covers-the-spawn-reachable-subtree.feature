# mutation-stamp: sha256=c3c91baf4855ea54a441e808d333becb341a5c3a8b578607ec3fc5ac590791e2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-24T11:51:20.868113456Z","feature_name":"every subprocess the handoff daemon can reach runs under the bounded chokepoint","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1031-bounded-chokepoint-covers-the-spawn-reachable-subtree.feature","background_hash":"dd08f3c58e3b7cce8810fec51b3de37bbdf288d3d5676115200e43cd25706c9f","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a converted call site returns when its child never exits","scenario_hash":"ffbd99e7ceed012ab2b12acffa20aae55a92e31444ad5d496982800286761243","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-08-24T11:21:43.739227694Z"}]}
# acceptance-mutation-manifest-end

Feature: every subprocess the handoff daemon can reach runs under the bounded chokepoint

  # BL-1031. BL-1022 widened the daemon's subprocess-API gate to follow spawn
  # edges as well as load edges. The wider closure immediately found three live
  # libraries - handoff_inject_lib.bb, pre_qa_gate_gather_lib.bb and
  # salvage_lib.bb - making UNBOUNDED babashka.process calls on the daemon's
  # critical path, the same class of call that deadlocked production in BL-1021.
  # Removing the banned API from a specific script was explicitly out of
  # BL-1022's scope, so it held the three as a ratchet instead of fixing them.
  # This is the ticket that clears the debt and retires the ratchet.

  Background:
    Given the handoff daemon's reachability closure over spawn and load edges

  # BL-1031 spawn-reachable-subtree-is-clean-01
  Scenario: no file the daemon can reach carries an unbounded subprocess call
    When the subprocess-API ban is scanned over every file in the closure
    Then no file outside the bounded chokepoint carries a banned subprocess API

  # BL-1031 wedged-child-costs-one-bounded-wait-02
  Scenario Outline: a converted call site returns when its child never exits
    Given <library> is called with a subprocess wait bound of 2000 milliseconds
    And the child process it starts never exits
    When the call runs
    Then it returns within the wait bound
    And the result reports exit code 124

    Examples:
      | library                   |
      | handoff_inject_lib.bb     |
      | pre_qa_gate_gather_lib.bb |
      | salvage_lib.bb            |

  # BL-1031 call-options-survive-conversion-03
  Scenario: a converted call still runs in the working directory it was given
    Given salvage_lib.bb's shell helper is called with a working directory
    When the call runs
    Then the child process runs in that directory

  # BL-1031 a-bound-hit-is-never-silent-04
  Scenario: a wait-bound hit is surfaced by name, never absorbed into a clean result
    Given the acceptance-contract step resolver exceeds the subprocess wait bound
    When the pre-QA gate evaluates the acceptance contract
    Then the gate's output names the wait-bound hit
    And the result is distinguishable from a contract that checked clean

  # BL-1031 ratchet-cannot-go-stale-05
  Scenario: a newly introduced unbounded call in the subtree fails the gate
    Given a file inside the closure reintroduces an unbounded subprocess call
    When the gate runs
    Then the gate fails and names that file and that call
