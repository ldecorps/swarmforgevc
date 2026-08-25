Feature: a unit test waiting on a real fs.watch event fails fast and says what never arrived

  # BL-933 (swarm-reliability). Three unit tests deliberately keep ONE
  # genuinely OS-async step: real fs.watch event delivery. BL-131 established
  # that this is correct and must stay real - faking it would mean replacing
  # fs.watch itself, and proving real events reach the debounce is the whole
  # point of these three tests. Everything else in them is already injected
  # (scheduleTick) and synchronous.
  #
  # What BL-131 did not add is a deadline. Each test awaits a bare promise
  # that only ever resolves when the event arrives:
  #
  #     const captured = new Promise((resolve) => { resolveCaptured = resolve; });
  #     ...
  #     await captured;
  #
  # When the OS delivers late or not at all - which is what a loaded host
  # does - that await simply runs out the lane's whole 20000ms budget and
  # reports a bare Vitest timeout naming the test, with nothing about which
  # event never came.
  #
  # The fix is a bounded, diagnosable wait, NOT a fake watcher and NOT a
  # bigger budget alone.
  #
  # Step handlers: specs/pipeline/steps/bl933BoundedWatchWaitSteps.js. The
  # <test> column is validated against explicit KNOWN_VALUES, never passed
  # through.

  Background:
    Given the three unit tests that await a real fs.watch event

  # BL-933 bounded-watch-wait-01
  Scenario Outline: each wait on a real watch event is bounded
    Given the test "<test>"
    When its wait for the real watch event is inspected
    Then the wait is bounded by an explicit deadline
    And no bare unbounded await on that event remains

    Examples:
      | test                                    |
      | bounce file creation is detected        |
      | a bounce-graceful file is detected      |
      | real watch events reach the debounce    |

  # BL-933 bounded-watch-wait-02
  Scenario: an expired wait says what never arrived
    Given a fixture in which the real watch event never arrives
    When the bounded wait expires
    Then the failure names the awaited watch event
    And the failure is raised by the test's own deadline rather than by the lane budget

  # BL-933 bounded-watch-wait-03
  Scenario: the watched events stay real
    When the three tests' watcher setup is inspected
    Then each still observes real filesystem events
    And no fake or stubbed watcher is substituted for the real one
