Feature: Cursor /pilot cleans orphan acceptance and Stryker at stage boundaries

  # BL-701: composePilotExpeditorPrompt requires checking and killing leftovers
  # from THIS expedition at stage boundaries and run end — hung acceptance
  # runners, leftover Stryker/mutation jobs, and related /tmp/tmp.* fixture
  # babysitter/bridge ancillaries. Host Cursor Remote bridge / Operator and
  # live-window protections stay out of scope. Do not rely solely on the host
  # orphan janitor. Telegram status posts are BL-700. Automated /expedite
  # stays unchanged.

  Background:
    Given the pilot expeditor prompt composer is available

  # BL-701 pilot-cleanup-01
  Scenario: the /pilot prompt requires stage-boundary orphan cleanup
    When the offline expeditor prompt is composed for ticket "BL-701"
    Then the prompt requires checking and killing leftover acceptance runners from this expedition
    And the prompt requires checking leftover Stryker or mutation jobs
    And the prompt requires checking related disposable /tmp/tmp.* ancillaries from the run

  # BL-701 pilot-cleanup-02
  Scenario: the /pilot prompt protects host bridge and Operator from cleanup
    When the offline expeditor prompt is composed for ticket "BL-701"
    Then the prompt forbids killing the host Cursor Remote bridge or Operator
    And the prompt says not to rely solely on the host orphan janitor
