Feature: the launchSwarm registry test is deterministic and spawns no real process

# BL-212 contract-preserved-03
Scenario: the tracked-job recording contract stays covered
  Given the de-flaked test and the existing spawnTrackedJob unit tests
  When the suite runs
  Then the "launchSwarm records a swarm-launch job keyed on the process group" contract remains verified

# Non-behavioral gates:
#  - No real detached process and no real timers in the test (isolation rule).
#  - Any production change is limited to adding an injectable spawn seam; launch
#    runtime behavior is unchanged.
