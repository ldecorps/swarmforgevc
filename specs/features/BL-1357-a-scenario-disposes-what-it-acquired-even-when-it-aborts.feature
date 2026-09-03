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
  Scenario: a failing disposal never replaces the failure that caused it
    Given a scenario whose disposal itself throws
    When the scenario aborts because a later step handler throws
    Then the original failure is still what the runner reports
    And the disposal failure is reported alongside it, not instead of it

  # BL-1357 scenario-disposes-what-it-acquired-05
  Scenario: each scenario of an Outline disposes its own resource
    Given an Outline whose Background acquires a resource for every example row
    When one example row aborts and the rest pass
    Then every row's resource is disposed exactly once
