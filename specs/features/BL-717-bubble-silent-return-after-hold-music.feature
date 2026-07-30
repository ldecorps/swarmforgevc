Feature: Bubble always speaks after hold music stops
  A Let's Talk turn that played hold music must end in audible speech — a real
  reply, or an explicit spoken failure line. Silence after the music stops
  reads to the human as "done talking" and hides whether the turn failed, came
  back empty, or is still running.
  Source: human via Let's Talk 2026-07-30; BL-717.

  Background:
    Given the Bubble companion is paired to a reachable bridge
    And hold music is enabled for working intervals

  # BL-717 hold-music-speech-01
  Scenario: a normal reply speaks when the music stops
    Given a Let's Talk turn that plays hold music while the agent works
    When the agent returns a reply with speakable content
    Then hold music stops and reply speech begins
    And the human does not hear silence in place of the reply

  # BL-717 hold-music-speech-02
  Scenario Outline: every terminal branch ends in speech, never silence
    Given a Let's Talk turn that plays hold music while the agent works
    When the turn ends because <branch>
    Then the human hears <spoken outcome>
    And the session does not return to idle without speaking

    Examples:
      | branch                                  | spoken outcome                        |
      | the agent returned no speakable content | a spoken nothing-to-say fallback line |
      | reply audio playback failed             | a spoken failure line                 |
      | speech synthesis failed                 | a spoken failure line                 |
      | the reply watchdog expired              | a spoken failure line                 |

  # BL-717 hold-music-speech-03
  Scenario: the bridge never reports success with nothing to say
    When a Let's Talk turn completes and the agent produced empty reply text
    Then the bridge does not answer the companion with a successful turn
    And the companion receives either speakable fallback text or an explicit failure

  # BL-717 hold-music-speech-04
  Scenario: the fallback never replaces a real reply
    Given a Let's Talk turn that plays hold music while the agent works
    When the agent returns a reply with speakable content
    Then the spoken output is that reply
    And no nothing-to-say fallback line is spoken

  # BL-717 hold-music-speech-05
  Scenario: the gap between music and speech is bounded
    Given a Let's Talk turn that plays hold music while the agent works
    When hold music stops at the end of the working interval
    Then reply speech or a spoken failure line begins within the documented bounded gap
    And no branch leaves an unbounded silent window
