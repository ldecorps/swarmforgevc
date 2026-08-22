# BL-1035 - a respawned front-desk bot gets its own startup grace
#
# The supervisor's startup grace is nil-guarded: front_desk_supervisor_lib.bb's
# `poll-heartbeat-stale?` waives staleness only when `last-heartbeat-ms` is NIL.
# The heartbeat lives in a FILE (.swarmforge/operator/front-desk-poll-heartbeat
# .json) that the bot rewrites on every completed poll cycle and that NOTHING
# resets at spawn, so a replacement is judged against the DEAD instance's
# timestamp - non-nil and already stale - and is declared stalled within one
# supervisor tick. Observed live 2026-08-22: start 06:13:56, "stalled bot no
# poll heartbeat within 90000 ms" 06:13:58, respawn 06:14:02.

Feature: the front-desk supervisor judges a freshly spawned bot on its own heartbeat, never on the one its predecessor left behind

  Background:
    Given the front-desk supervisor is watching the bot
    And the bot records a poll heartbeat in a file that outlives the process that wrote it

  # BL-1035 a-respawn-is-not-instantly-stalled-01
  Scenario: a replacement is not condemned by its predecessor's heartbeat
    Given the previous bot instance left a poll heartbeat older than the stall window
    When the supervisor spawns a bot
    Then the spawned bot is not declared stalled while its startup grace is running

  # BL-1035 the-grace-still-expires-02
  Scenario: the grace ends, so a replacement that never polls is still caught
    Given the previous bot instance left a poll heartbeat older than the stall window
    And the spawned bot completes no poll cycle
    When the spawned bot's startup grace elapses
    Then the spawned bot is declared stalled

  # BL-1035 a-real-heartbeat-clears-it-03
  Scenario: a heartbeat the replacement itself wrote clears the grace early
    Given the previous bot instance left a poll heartbeat older than the stall window
    When the spawned bot completes its first poll cycle
    Then the spawned bot is not declared stalled

  # BL-1035 a-first-ever-start-keeps-its-grace-04
  Scenario: the case that already worked keeps working
    Given no poll heartbeat has ever been recorded
    When the supervisor spawns a bot
    Then the spawned bot is not declared stalled while its startup grace is running

  # BL-1035 no-tight-restart-loop-05
  Scenario: a stale heartbeat cannot spend the restart budget in seconds
    Given the previous bot instance left a poll heartbeat older than the stall window
    And the spawned bot completes no poll cycle
    When the supervisor runs for the length of one startup grace
    Then the supervisor has spawned at most one bot in that window
