Feature: The benchmark battery is hard enough to tell models apart

# BL-386 (epic BL-384, slice 2): the sole battery item today is one exported function in ONE file
# against a provided test file — every model one-shot it, so quality pinned at 6/6 for all three and
# the benchmark had nothing left to discriminate on. A metric that saturates is not a metric. The
# quality metric itself is already fractional (testsPassed / testsTotal); it does not need to be made
# graded, it needs something to grade. This slice raises the ceiling: several tasks, spanning files,
# holding invariants the tests never state.
#
# The report today carries a single top-level `taskId` — the harness runs exactly ONE task — so
# making the battery a SET is itself part of this slice.

Background:
  Given a benchmark battery of several tasks

# BL-386 the-battery-can-actually-separate-models-01
Scenario: Every task in the battery is run, not just the first
  When the benchmark runs the battery against a model
  Then every task in the battery is attempted

# BL-386 the-battery-can-actually-separate-models-02
Scenario: Each task is scored in its own right
  When the benchmark runs the battery against a model
  Then the report carries that model's score for each task separately

# BL-386 the-battery-can-actually-separate-models-03
Scenario: A model's overall quality is its showing across the whole battery
  When the benchmark runs the battery against a model
  Then that model's overall quality reflects every task in the battery

# BL-386 the-battery-can-actually-separate-models-04
Scenario: The battery probes what a trivial task cannot
  Then the battery holds a task whose solution spans several files
  And the battery holds a task that depends on an invariant its tests never state

# BL-386 the-battery-can-actually-separate-models-05
Scenario: A task that even a correct solution cannot pass is refused
  Given a task whose own reference solution does not pass its tests
  When the benchmark runs the battery against a model
  Then that task is refused as unsound
  And no model is scored against it
