Feature: An update the cursor bridge reads for the front desk is never dropped
  While the front desk's poll heartbeat is stale, the cursor bridge's
  dead-feeder fallback (BL-1253) holds getUpdates on the shared token. Every
  update it reads then is gone from Telegram, so one it has no route for -
  an Approve or Reject tap, an approve verb typed in the Approvals topic -
  must reach the front desk, not be answered and dropped. On 2026-10-07 the
  human's taps on BL-2058 and BL-2059 recorded nothing this way (c416adc5fb
  shortened the window; this closes it).

  Background:
    Given the front desk's poll heartbeat is older than 90 seconds, so the cursor bridge holds getUpdates
    And ticket BL-9061 is pending approval

  # BL-2061 an-update-the-bridge-reads-for-the-front-desk-is-never-dropped-01
  Scenario Outline: a front-desk update the bridge reads is applied once the front desk polls again
    When the human sends <update> while the bridge holds getUpdates
    And the front desk polls again
    Then BL-9061's human_approval reads <outcome>

    Examples:
      | update                                          | outcome  |
      | an Approve tap on BL-9061's ask                 | approved |
      | a Reject tap on BL-9061's ask                   | rejected |
      | the text approve BL-9061 in the Approvals topic | approved |

  # BL-2061 an-update-the-bridge-reads-for-the-front-desk-is-never-dropped-02
  Scenario: a message in the cursor topic is still the bridge's own
    When the human sends a message in the cursor topic while the bridge holds getUpdates
    Then the bridge handles the message
    And nothing is handed to the front desk

  # BL-2061 an-update-the-bridge-reads-for-the-front-desk-is-never-dropped-03
  Scenario: an update handed over twice is applied once
    When the bridge hands the same Approve tap on BL-9061's ask to the front desk twice
    And the front desk polls again
    Then BL-9061's human_approval reads approved
    And BL-9061's approval is recorded once
