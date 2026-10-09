Feature: BL-2097 A long poll that never answers is abandoned before the supervisor kills the bot

  The front-desk bot asks Telegram for a 25 s long poll and waits for the
  answer with no deadline of its own. BL-2072's timing lines show what
  that costs: from 11:26Z to 13:53Z on 2026-10-09, 84 getUpdates waits ran
  past 27 s (median 42 s, longest 93 s). Every slow line named getUpdates;
  no other phase ran long. A wait that passes 90 s leaves the poll heartbeat
  stale, the supervisor kills the bot, and the bridge's own 90 s feeder
  check hands getUpdates to the bridge. The kill at 13:01:22Z landed on a
  poll that had been in flight for 91 s. The bot now abandons a getUpdates
  call that has not answered by its deadline. The cycle ends as a failed
  poll that keeps its offset, so the heartbeat is written in time and no
  update is lost.

  Background:
    Given a front-desk bot over a fake Telegram, a fake clock and a temp operator directory

  # BL-2097 unanswered-long-poll-is-abandoned-01
  Scenario: a getUpdates call that never answers is abandoned before the supervisor's 90 s
    Given Telegram never answers the bot's getUpdates call
    When the bot runs one poll cycle from offset 41
    Then the cycle ends by the 45th second of the fake clock
    And the getUpdates request was aborted before the cycle ended
    And the cycle writes the poll heartbeat
    And front-desk-diagnostics.log gains a line naming getUpdates wait as abandoned and its duration
    And the next cycle polls from offset 41

  # BL-2097 answered-long-poll-is-kept-02
  Scenario Outline: a getUpdates call that answers before the deadline is handled as before
    Given Telegram answers the bot's getUpdates call after <seconds> seconds with update 41
    When the bot runs one poll cycle from offset 41
    Then the getUpdates request was not aborted
    And update 41 is handled
    And the next cycle polls from offset 42

    Examples:
      | seconds |
      | 1       |
      | 30      |
