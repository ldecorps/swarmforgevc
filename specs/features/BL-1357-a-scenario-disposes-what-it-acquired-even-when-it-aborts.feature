# mutation-stamp: sha256=ff65de6133338a0d86b8b5ca2f284f7cf7bc3440c1fe780b8e1bf2106ab4e7d2
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-09-08T23:47:46.522059599Z","feature_name":"A scenario disposes what it acquired, even when it aborts before its last step","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-1357-a-scenario-disposes-what-it-acquired-even-when-it-aborts.feature","background_hash":"36d04a11704caf14703d30261e7948acb10ace0311edb22eea460c92318a235f","implementation_hash":"unknown","scenarios":[{"index":1,"name":"a scenario that aborts still disposes what it acquired","scenario_hash":"185ad4a5de30ac2aab6b5cce2467d43d5a90833e8cb2d9238ab715613fc8d46e","mutation_count":2,"result":{"Total":2,"Killed":2,"Survived":0,"Errors":0},"tested_at":"2026-09-08T23:47:46.522059599Z"}]}
# acceptance-mutation-manifest-end

Feature: A scenario disposes what it acquired, even when it aborts before its last step
  `runScenario` builds a fresh `context` per scenario, walks Background steps
  then scenario steps, and returns. It has no `finally` and calls no teardown -
  so anything a step put in that context outlives the scenario whenever the walk
  does not reach the end.

  Step files that hold real resources compensate by defining their own
  `teardown(ctx)` and calling it from a late step. That works only when the walk
  gets there. Two ways it does not: a step handler throws (runtime.js:29), or no
  handler matches the step text at all (runtime.js:24) - and the second is
  raised BEFORE `resolved.handler` is ever called, so it is outside even the
  per-step try/catch, which is why no amount of care inside a handler can catch
  it.

  Gherkin mutation makes the second case routine rather than exotic: mutating an
  Outline cell is exactly how a step stops matching. BL-1351's Background ends
  `And a client connected to /events` - a real client polling a real bridge every
  20ms over 1223 items. One mutated trigger left it connected with nothing to
  close it, and it held a mutation worker for 808 seconds.

  Background:
    Given a scenario whose Background step acquires a disposable resource

  # BL-1357 scenario-disposes-what-it-acquired-01
  Scenario: a scenario that runs to completion disposes what it acquired
    When every step matches and passes
    Then the resource is disposed once after the last step

  # BL-1357 scenario-disposes-what-it-acquired-02
  Scenario Outline: a scenario that aborts still disposes what it acquired
    When the scenario aborts because <cause>
    Then the resource is disposed
    And the original failure is still what the runner reports

    Examples:
      | cause                                      |
      | a later step handler throws                |
      | no handler matches a later step's text     |

  # BL-1357 scenario-disposes-what-it-acquired-03
  Scenario: a scenario that acquired nothing needs no disposal
    Given a scenario whose steps acquire no disposable resource
    When every step matches and passes
    Then the runner completes without attempting any disposal

  # BL-1357 scenario-disposes-what-it-acquired-04
  Scenario: a scenario can register a disposal that throws
    Given a scenario whose disposal itself throws
    When every step matches and passes
    Then the disposal mechanism is set up correctly

  # BL-1357 scenario-disposes-what-it-acquired-05
  Scenario: each scenario of an Outline disposes its own resource
    Given an Outline whose Background acquires a resource for every example row
    When one example row aborts and the rest pass
    Then every row's resource is disposed exactly once
