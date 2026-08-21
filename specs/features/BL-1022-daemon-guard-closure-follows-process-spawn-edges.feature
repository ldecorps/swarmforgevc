Feature: the daemon subprocess-API gate closes over spawned scripts, not only loaded ones

  # BL-1022. daemon_cycle_guard_lib_test_runner.bb walks the load-file
  # closure from handoffd.bb and asserts no subprocess path escapes the
  # bounded chokepoint. That gate is real and it holds - but it follows one
  # edge type. handoffd reaches swarm_handoff.bb by SPAWNING it
  # (sh! ["bb" <script> ...]), and a process-spawn edge is invisible to a
  # load-file walk, so the banned clojure.java.shell API sat on the daemon's
  # critical path unseen until it deadlocked production (BL-1021).
  # A derived guard still has a depth; one hop is the default nobody
  # notices choosing.

  Background:
    Given the daemon subprocess-API gate walks the reachability graph from the handoff daemon

  # BL-1022 spawn-edge-is-followed-01
  Scenario: a script reached only by a process spawn is inside the gate's closure
    Given a script the daemon reaches only by spawning it as a subprocess
    When the gate computes its closure
    Then that script is included in the closure

  # BL-1022 banned-api-in-a-spawned-script-fails-02
  Scenario: the gate fails when a spawned script uses the banned subprocess API
    Given a script inside the closure uses an unbounded clojure.java.shell call
    When the gate runs
    Then the gate fails and names that script and that call

  # BL-1022 closure-is-transitive-over-both-edge-kinds-03
  Scenario: closure follows spawn and load edges transitively together
    Given a spawned script itself loads a second file that spawns a third
    When the gate computes its closure
    Then all three files are included in the closure

  # BL-1022 closure-is-reported-04
  Scenario: the gate reports what it actually covered
    Given a script the daemon reaches only by spawning it as a subprocess
    When the gate computes its closure
    Then the report names every file in the closure and how each was reached
