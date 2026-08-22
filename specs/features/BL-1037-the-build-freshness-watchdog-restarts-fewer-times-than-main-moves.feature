# BL-1037 - the build-freshness watchdog restarts fewer times than main moves
#
# BL-582 gap (c) restarts a HEALTHY front-desk child once its build_sha has
# trailed main's tip for FRONT_DESK_BUILD_GRACE_MS (default 300000). Correct in
# principle: before it, a build served 2h23m stale. But this swarm lands commits
# on main faster than one grace window plus recompile-and-respawn clears, so
# staleness re-arms before the previous restart has finished paying for itself -
# 24 build-stale-detected events and 12 bot respawns between 04:30Z and 06:14Z on
# 2026-08-22, each respawn costing a Telegram conflict window (BL-1036) and, when
# it followed a stall, a tight restart loop (BL-1035).
#
# This slice bounds the restart RATE without letting staleness be lost. It does
# not undo the watchdog.

Feature: the build-freshness watchdog bounds how often it restarts a healthy front desk, without ever losing the staleness it saw

  Background:
    Given the front-desk supervisor is watching a healthy bot

  # BL-1037 no-restart-before-the-current-build-has-served-01
  Scenario: a replacement is left alone until it has actually served
    Given a restart onto a fresh build has just completed
    And main moves again immediately
    When the watchdog runs
    Then the replacement is not restarted before it has completed a poll cycle

  # BL-1037 a-burst-costs-fewer-restarts-than-commits-02
  Scenario: a burst of commits does not cost a restart per commit
    Given the bot is running a build that main has moved past
    And commits land on main faster than one restart cycle completes
    When more than one build grace elapses
    Then the bot is restarted fewer times than the number of commits that landed

  # BL-1037 staleness-is-carried-not-lost-03
  Scenario: staleness deferred is still staleness owed
    Given the bot is running a build that main has moved past
    And commits land on main faster than one restart cycle completes
    When the burst ends
    Then the bot is running main's newest build within one build grace of the last commit

  # BL-1037 a-quiet-main-costs-nothing-04
  Scenario: a build that matches main is never restarted
    Given the bot is running main's newest build
    When more than one build grace elapses
    Then the bot is not restarted

  # BL-1037 each-restart-still-names-its-target-05
  Scenario: the log still says what each restart moved to
    Given the bot is running a build that main has moved past
    When the watchdog restarts the bot onto a fresh build
    Then the supervisor log records that restart and the build it moved to
