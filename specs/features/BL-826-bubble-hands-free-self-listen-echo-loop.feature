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
