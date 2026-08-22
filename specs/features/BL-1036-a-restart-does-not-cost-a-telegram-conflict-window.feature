# BL-1036 - a front-desk restart does not cost a Telegram conflict window
#
# Every respawn in .swarmforge/operator/front-desk-supervisor.log is followed by
# "poll degraded - 5 consecutive failures ... 409: Conflict: terminated by other
# getUpdates request" - 12 restarts, 12 conflicts, 2026-08-22 04:30Z-06:14Z. Ruled
# out at spec time: no second poller exists on this host. Exactly one front-desk
# bot process runs (pid 5562 at the time of writing), and the only other holder of
# TELEGRAM_BOT_TOKEN, telegram-cursor-bridge.js, runs with
# CURSOR_BRIDGE_INBOUND_QUEUE=1 and calls getUpdates never.
#
# The log also never says the poll RECOVERED - only that it degraded - so an
# operator reading it cannot tell an outage from a blip.

Feature: restarting the front-desk bot does not leave its replacement conflicting with the poll slot the old process held

  Background:
    Given the front-desk supervisor is watching the bot
    And exactly one process holds the front-desk bot token

  # BL-1036 a-restart-polls-cleanly-01
  Scenario: the replacement's first poll cycle succeeds
    Given the bot is running and polling
    When the supervisor restarts the bot
    Then the replacement completes its first poll cycle without a conflict

  # BL-1036 the-old-poll-slot-is-released-first-02
  Scenario: the old instance's long poll is released before the replacement polls
    Given the bot is holding an open long poll
    When the supervisor restarts the bot
    Then the replacement does not begin polling before the old poll slot is released

  # BL-1036 an-unclean-exit-is-bounded-03
  Scenario: a process that ignores SIGTERM does not buy an unbounded conflict window
    Given the bot ignores its termination signal and is killed outright
    When the supervisor restarts the bot
    Then the replacement retries with backoff until the conflict clears
    And the conflict window ends within the bot's own retry budget

  # BL-1036 recovery-is-announced-04
  Scenario: the log says the poll recovered, not only that it degraded
    Given the replacement's poll has been reported as degraded
    When the replacement's poll starts succeeding again
    Then the supervisor log records that the poll recovered

  # BL-1036 a-conflict-that-outlives-the-budget-escalates-05
  Scenario: a conflict that outlasts the retry budget is escalated rather than retried in silence
    Given the conflict does not clear within the bot's retry budget
    When the retry budget is exhausted
    Then the supervisor log records the conflict as unresolved
