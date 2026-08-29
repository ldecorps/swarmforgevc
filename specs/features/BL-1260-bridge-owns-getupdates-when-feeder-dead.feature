Feature: The Host bridge owns getUpdates only while the front desk has stopped feeding it

  The Host bridge and the front-desk bot can share one Telegram bot token. Only
  one process may call getUpdates on a token — two callers and Telegram answers
  409 and neither reads reliably. So in shared-token mode the bridge normally
  stays silent and drains an on-disk queue the front desk writes for it.

  The fault this certifies: the front desk stopped feeding that queue while the
  bridge's own heartbeat stayed healthy. The bridge went on draining an empty
  file, so an operator's message sat in Telegram unanswered with every liveness
  signal green. The fix gives the bridge a second signal — the front desk's own
  poll heartbeat — and lets it take the token over when that signal goes stale.

  The decision is re-read on every poll, because the failure it exists to catch
  appears in the middle of a run, not at startup.

  Background:
    Given the front desk polls Telegram with its own bot token

  # BL-1260 bridge-getupdates-ownership-01
  Scenario Outline: The bridge's own token, then the feeder heartbeat, decide who owns getUpdates
    Given the bridge has <bridge token>
    And the front desk poll heartbeat is <heartbeat>
    When the bridge decides how to read its next batch of updates
    Then the bridge <behaviour>

    Examples:
      | bridge token          | heartbeat                       | behaviour                        |
      | no token of its own   | fresh                           | drains the on-disk inbound queue |
      | no token of its own   | exactly at the stall window     | drains the on-disk inbound queue |
      | no token of its own   | older than the stall window     | calls getUpdates itself          |
      | no token of its own   | missing                         | calls getUpdates itself          |
      | no token of its own   | present but not a finite number | calls getUpdates itself          |
      | its own exclusive token | fresh                         | calls getUpdates itself          |

  # BL-1260 bridge-getupdates-ownership-02
  Scenario: A feeder that dies mid-run is taken over without restarting the bridge
    Given the bridge has no token of its own
    And the front desk poll heartbeat is fresh
    And the bridge has already polled once and drained the queue
    When the front desk stops stamping its heartbeat
    And the stall window elapses
    And the bridge polls again
    Then the bridge calls getUpdates itself
    And the bridge did not have to be restarted to change its mind

  # BL-1260 bridge-getupdates-ownership-03
  Scenario: A recovered feeder gets the token back
    Given the bridge has no token of its own
    And the front desk poll heartbeat is older than the stall window
    And the bridge owns getUpdates
    When the front desk resumes stamping its heartbeat
    And the bridge polls again
    Then the bridge drains the on-disk inbound queue

  # BL-1260 bridge-getupdates-ownership-04
  Scenario: A caller that supplies no feeder signal keeps the safe default
    Given the bridge has no token of its own
    And the bridge is asked to decide with no feeder signal supplied
    When the bridge decides how to read its next batch of updates
    Then the bridge drains the on-disk inbound queue
