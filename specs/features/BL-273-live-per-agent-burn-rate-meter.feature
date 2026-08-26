Feature: Live per-agent token burn-rate meter on the holistic UI

  Background:
    Given each role's transcript usage records carry a timestamp and token counts
    And the burn-rate is evaluated over a recent rolling window at a fixed injected instant

  # BL-273 burn-rate-01
  Scenario: an agent's burn-rate is its recent token throughput extrapolated to an hourly rate
    Given a role consumed tokens during the window
    When the per-agent burn-rate is computed
    Then that role's rate is the total of its input, output, and cache tokens in the window, extrapolated to tokens per hour

  # BL-273 burn-rate-02
  Scenario: an idle agent reports a zero burn-rate
    Given a role was idle during the window
    When the per-agent burn-rate is computed
    Then that role's rate is zero tokens per hour

  # BL-273 burn-rate-03
  Scenario: the live burn-rate endpoint requires authorization
    When an unauthorized request is made to the burn-rate endpoint
    Then the request is rejected
