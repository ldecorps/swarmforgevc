Feature: unit test suite runs without real wall-clock waits

# BL-131 no-real-timers-01
Scenario: no test file under extension/test waits on the real clock
  Given the full extension unit test suite
  When it runs
  Then no test contains a bare `setTimeout`/`setInterval` call or an
    `await new Promise(resolve => setTimeout(resolve, <ms>))` wait on the
    real clock
  And every timer-dependent behavior is driven by an injected/fake clock
    advanced explicitly within the test

# BL-131 suite-speed-02
Scenario: the suite runtime drops drastically
  Given the current recorded baseline in .test-durations.jsonl
    (88 tests, ~47000-91000 ms)
  When the real-timer removal lands
  Then a full unit test run completes in on the order of a few seconds,
    not tens of seconds, for the same or larger test count

# BL-131 behavior-preserved-03
Scenario: timer-dependent production behavior is unchanged
  Given a module whose timer call site is made injectable to satisfy
    no-real-timers-01
  Then its production (non-test) runtime behavior and default interval/
    timeout values are identical to before the change

# Non-behavioral gates:
#  - Test-only change in intent; production code may only change to make
#    an existing timer injectable, never to alter runtime timing behavior.
#  - Does not apply to property tests or Gherkin acceptance timing (already
#    excluded by the shared engineering article).
#  - This enforces the existing "Test Speed And Isolation" rule already in
#    the engineering article; it does not add a new rule.
