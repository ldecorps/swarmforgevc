# mutation-stamp: sha256=88710e8ceb3ba7ca210b6f52c9afcbb2d8bda6a9d73711e0aa9de1ebf5aef002
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-07T02:30:57.271967Z","feature_name":"Bubble does not open the mic onto its own voice","feature_path":"/Users/ldecorps/projects/swarmforgevc/.worktrees/hardender/specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature","background_hash":"c23bd1348caf861a59da975037237b60841e59bddd56bf51d813886c8fc1feae","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the re-arm gate's decision is covered by the JVM unit suite","scenario_hash":"aeafe040f09e64b5b72b86cb4f14a0c6a501cfe12a7ad93d6326ace57b90438f","mutation_count":6,"result":{"Total":6,"Killed":6,"Survived":0,"Errors":0},"tested_at":"2026-08-07T02:30:57.271967Z"}]}
# acceptance-mutation-manifest-end

Feature: Bubble does not open the mic onto its own voice

  In hands-free mode Bubble arms the mic a fixed 400 ms after the playback-done
  signal (TalkEngine.onPlaybackDone -> HANDS_FREE_POST_SPEECH_MS). That signal
  can fire while audio is still in the speaker path, so the mic hears Bubble's
  own reply tail, the 2.5 s silence rule submits it as a turn, and Bubble
  answers itself. The loop self-feeds and does not end without the human turning
  hands-free off.

  The fix is a gate in front of every re-arm: playback is not finished when the
  player says so, it is finished when the player says so AND a measured quiet
  tail has followed. That decision is pure logic with no android.* type in its
  own signature, so per the constitution's Testability Boundary — Bubble it is
  verified by the JVM unit suite. The microphone, the speaker path and acoustic
  echo cancellation are device surface and are verified by the manual procedure
  recorded in BL-826.

  Background:
    Given the Bubble Android module

  # BL-826 hands-free-self-listen-echo-loop-01
  Scenario Outline: the re-arm gate's decision is covered by the JVM unit suite
    When the JVM unit suite is run
    Then it exercises <decision>

    Examples:
      | decision                                                                  |
      | refusing to arm the mic while playback is still reported active           |
      | refusing to arm until a quiet tail has followed the playback-done signal  |
      | restarting the quiet tail when audio resumes before it completes          |
      | arming the mic once an uninterrupted quiet tail has elapsed               |
      | discarding audio captured inside the post-arm settle window               |
      | arming after a failed turn that produced no playback at all               |
