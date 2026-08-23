Feature: A Cursor Remote run failure is recorded on this host, not only in a Telegram message

  The supervisor already redirects the bridge process's stdout and stderr into
  .swarmforge/operator/cursor-bridge.log. The bridge never prints its run
  failures, so that log holds only supervisor-spawn lines while the reasons
  live in a Telegram scrollback nobody can grep - on the surface most likely
  to be unusable during the failure being diagnosed.

  Background:
    Given a Cursor Remote bridge running under its supervisor
    And the supervisor redirects the bridge's output to "cursor-bridge.log"

  # BL-1050 cursor-run-failure-log-01
  Scenario: a failed run is recorded with its run id and the SDK's reason
    When a Cursor run ends with status "error" and reason "Connection failed repeatedly"
    Then "cursor-bridge.log" gains a line naming that run id
    And that line names the reason "Connection failed repeatedly"

  # BL-1050 cursor-run-failure-log-02
  Scenario Outline: the session-reset decision is recorded alongside the failure
    When a Cursor run ends with status "error" and reason "<reason>"
    Then "cursor-bridge.log" records the session reset decision as "<decision>"

    Examples:
      | reason                       | decision  |
      | Connection failed repeatedly | reset     |
      | already has active run       | reset     |
      | resource_exhausted           | not-reset |

  # BL-1050 cursor-run-failure-log-03
  Scenario: the record does not depend on Telegram accepting the post
    Given posting to Telegram fails
    When a Cursor run ends with status "error" and reason "Connection failed repeatedly"
    Then "cursor-bridge.log" gains a line naming that run id

  # BL-1050 cursor-run-failure-log-04
  Scenario: a successful run adds no failure line
    When a Cursor run ends with status "finished"
    Then "cursor-bridge.log" gains no failure line

  # BL-1050 cursor-run-failure-log-05
  Scenario: no secret and no conversation content reaches the log
    Given the bridge holds an API key and a bot token in its environment
    When a Cursor run carrying the prompt "deploy the staging key" ends with status "error"
    Then "cursor-bridge.log" names no value from the bridge's environment
    And "cursor-bridge.log" does not name the prompt text

  # BL-1050 cursor-run-failure-log-06
  Scenario: the Telegram wording a human sees is untouched by the logging
    When a Cursor run ends with status "error" and reason "Connection failed repeatedly"
    Then the Cursor Remote topic is told "Cursor run failed" with that run id and that reason
    And no log line text reaches the Cursor Remote topic
