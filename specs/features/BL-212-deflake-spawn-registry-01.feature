Feature: the launchSwarm registry test is deterministic and spawns no real process

# BL-212 no-real-spawn-01
Scenario: the registry-recording test uses a spawn double, not a real detached process
  Given the launchSwarm registry-recording test
  When it runs
  Then it asserts the tracked-job entry without launching a real OS process
  And it leaves no process group behind to kill

# BL-212 parallel-stable-02
Scenario: the test passes deterministically under parallel load
  Given the full unit suite running with parallelism
  When the registry-recording test runs repeatedly under contention
  Then it passes every time, with no intermittent failure

# BL-212 contract-preserved-03
Scenario: the tracked-job recording contract stays covered
  Given the de-flaked test and the existing spawnTrackedJob unit tests
  When the suite runs
  Then the "launchSwarm records a swarm-launch job keyed on the process group"
    contract remains verified

# Non-behavioral gates:
#  - No real detached process and no real timers in the test (isolation rule).
#  - Any production change is limited to adding an injectable spawn seam; launch
#    runtime behavior is unchanged.
