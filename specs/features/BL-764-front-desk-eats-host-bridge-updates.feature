Feature: One poller owns a Telegram bot token and fans updates out to the Host bridge

  With one bot token shared between the front desk and the Cursor Remote
  bridge, only the front desk may call getUpdates. Bridge-owned updates reach
  the bridge over an on-disk queue instead of being dropped, and a standing
  busy/idle line makes the bridge's state visible.

  Background:
    Given the front desk and the Cursor Remote bridge are configured with the same bot token

  # BL-764 dual-poller-01
  Scenario: A bridge-owned update is forwarded rather than dropped
    Given an inbound message arrives in a bridge-owned topic
    When the front desk classifies that update
    Then the update is appended to the Cursor Remote inbound queue
    And the update is not routed to SUP or Operator

  # BL-764 dual-poller-02
  Scenario Outline: Only the shared-token bridge reads its updates from the queue
    Given the bridge is launched with <token_mode>
    When the bridge starts polling
    Then it consumes inbound updates from <source>
    And the number of processes calling getUpdates on that token is one

    Examples:
      | token_mode                    | source            |
      | a token shared with front desk | the inbound queue |
      | its own exclusive token        | Telegram directly |

  # BL-764 dual-poller-03
  Scenario: Draining the queue does not lose an update appended during the drain
    Given the inbound queue holds one pending update
    When a drain reads the queue and a second update is appended before the drain completes
    Then the first update is returned exactly once
    And the second update is still available to the next drain

  # BL-764 dual-poller-04
  Scenario: Help does not open a poller
    When the bridge CLI is invoked with the help flag and no Telegram environment
    Then it prints usage and exits successfully
    And it opens no Telegram long poll

  # BL-764 dual-poller-05
  Scenario Outline: The standing liveness line is edited in place, not reposted
    Given the Cursor Remote liveness line already shows <before>
    When the bridge state becomes <after>
    Then the existing liveness message is edited rather than a new one posted
    And the line reports the number of turns still waiting

    Examples:
      | before | after |
      | idle   | busy  |
      | busy   | idle  |
