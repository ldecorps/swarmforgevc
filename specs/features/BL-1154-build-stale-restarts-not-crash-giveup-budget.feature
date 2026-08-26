Feature: Healthy build-stale restarts do not burn the front-desk crash give-up budget
  Live logs around the recurring give-up email spam showed heavy build-stale
  detect/restart churn on otherwise healthy children. If voluntary
  stale-build rolls consume the same attempt budget as crashes, the desk
  hits give-up without a true crash loop.

  This slice separates that accounting so build-stale restarts cannot alone
  exhaust the crash give-up budget.

  # BL-1154 build-stale-not-crash-budget-01
  Scenario: A voluntary build-stale restart does not consume a crash give-up attempt
    Given the front-desk supervisor detects a healthy child as build-stale
    When it restarts that child onto a fresh Node build
    Then the crash / give-up attempt counter is not incremented the same way as a crash restart

  # BL-1154 build-stale-crash-loop-still-gives-up-02
  Scenario: A true crash loop still reaches give-up and escalates
    Given the bridge repeatedly exits unsuccessfully within the attempt budget
    When the attempt budget is exhausted
    Then the supervisor still enters give-up and may escalate once per episode (BL-1151)
