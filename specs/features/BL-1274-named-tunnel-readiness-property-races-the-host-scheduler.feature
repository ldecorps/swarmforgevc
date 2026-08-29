Feature: BL-1274 the named-tunnel readiness property does not race the host scheduler
  The bl787 invariant-1 property launches the real named-tunnel launcher against a
  fake cloudflared that prints a log the fixture has already written to disk. The
  registration text exists before the launcher starts; what the property actually
  races is the host scheduling that subprocess. When the host wins, the launcher
  exits non-zero and the property fails on a correct implementation - a verdict
  that is a function of host load rather than of the code under test. BL-871
  widened the readiness budget from 2s to 20s for this exact assertion on
  2026-08-11; it went red again with that budget in place on 2026-08-29, so a
  third widening is not the remedy. The assertion itself is load-bearing - it is
  what keeps the launcher from inferring readiness from liveness alone - so it
  must survive the fix intact.

  Background:
    Given the named-tunnel launcher is correct
    And the fixture has written the registration line to the log before the launcher starts

  # BL-1274 readiness-not-a-race-01
  Scenario Outline: readiness is observed regardless of when the fake tunnel process is scheduled
    Given the fake cloudflared does not begin emitting its log until <startup delay>
    When the readiness property runs
    Then the property passes
    And the launcher reports the tunnel hostname and writes tunnel state

    Examples:
      | startup delay                                  |
      | immediately                                    |
      | after the pre-change readiness budget elapses  |

  # BL-1274 readiness-not-a-race-02
  Scenario: the property still fails when readiness is inferred from liveness alone
    Given the fake cloudflared stays alive but never emits a registration line
    When the readiness property runs
    Then the property fails
    And no tunnel state is written

  # BL-1274 readiness-not-a-race-03
  Scenario: no wait budget was widened to reach green
    When the readiness wait budgets are compared against their values before the change
    Then no wait budget is larger than it was before the change
