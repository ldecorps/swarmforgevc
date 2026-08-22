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
