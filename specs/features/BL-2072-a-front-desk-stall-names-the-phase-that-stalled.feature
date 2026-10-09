# mutation-stamp: sha256=0933ceec1af7647b2a4f513d1c9818e2f4a3e080af049e170d11d689fbc8817a
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-10-08T23:29:50.612996022Z","feature_name":"A front-desk stall names the phase that stalled","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-2072-a-front-desk-stall-names-the-phase-that-stalled.feature","background_hash":"be0c717bf793a985ff06efc26390d301d0df0644a6d0fca8e5f51a0cfeaed373","implementation_hash":"unknown","scenarios":[{"index":0,"name":"a phase that runs long leaves a timing line naming it","scenario_hash":"f0b254bfcd465ed841d77bacb206e4567d313f42f459a86016de7b318a62baf5","mutation_count":3,"result":{"Total":3,"Killed":3,"Survived":0,"Errors":0},"tested_at":"2026-10-08T23:29:50.612996022Z"}]}
# acceptance-mutation-manifest-end

Feature: A front-desk stall names the phase that stalled
  The front-desk supervisor kills the bot when its poll heartbeat is 90 s
  old. On 2026-10-07 it did so 37 times with no 409 involved, including at
  11:32Z and 11:34Z, 135 s after a fresh start. The bot writes the heartbeat
  once when its poll loop begins - after the startup topic checks - and
  then after each completed cycle, so a slow startup step, a slow long poll
  or a slow batch of updates all look the same from outside. Each of those
  phases now leaves a timing line in front-desk-diagnostics.log when it
  runs long, so the next kill shows which one stalled.

  Background:
    Given a front-desk bot over a fake Telegram and a temp operator directory

  # BL-2072 front-desk-stall-names-its-phase-01
  Scenario Outline: a phase that runs long leaves a timing line naming it
    Given the bot's <phase> takes 30 seconds
    When the bot runs it
    Then front-desk-diagnostics.log gains a line naming <phase> and a duration of at least 30 seconds

    Examples:
      | phase                        |
      | startup topic checks         |
      | getUpdates wait              |
      | handling of one update batch |

  # BL-2072 front-desk-stall-names-its-phase-02
  Scenario: a phase that runs quickly leaves no timing line
    Given every phase of the bot's first poll cycle takes under a second
    When the bot runs the cycle
    Then front-desk-diagnostics.log gains no timing line
