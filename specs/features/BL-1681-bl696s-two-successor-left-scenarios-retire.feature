Feature: BL-1681 BL-696's two successor-left scenarios retire, and the recoverability contract survives as a server-half scenario
  Two scenarios in BL-696's features asserted behaviour the 2026-07-29
  batch land replaced: the page's error conversation phase (removed by
  BL-696's own post-ship UX) and an immediate bare /redeploy (gated by
  BL-702 behind a soft confirm). They are retired, never reworded. The
  half of lets-talk-06 that is still true - a transient speech-to-text
  failure is reported recoverable and the retried turn completes - is
  restated here over the turn route itself.

  # BL-1681 a-transient-stt-failure-is-recoverable-at-the-route-01
  Scenario: a transient speech-to-text failure is reported recoverable and the retried turn completes
    Given a running Let's Talk bridge whose speech-to-text fails transiently once then succeeds
    When a spoken turn is submitted to the audio turn route
    Then the response reports the turn as not successful, recoverable, in state "error"
    When the same spoken turn is submitted again
    Then the response reports success with a spoken reply

  # BL-1681 the-retired-scenarios-are-gone-and-both-features-run-green-02
  # Census pin (BL-1445): the remaining scenario counts are named, not derived.
  Scenario Outline: each BL-696 feature runs green without its retired scenario
    When <feature> is run through the acceptance runner in a child process
    Then every scenario passes
    And no scenario is named "<retired>"
    And the feature has exactly <remaining> scenarios

    Examples:
      | feature                                                 | retired                                                                    | remaining |
      | BL-696-miniapp-lets-talk-cursor-audio.feature           | a transient speech-to-text failure is recoverable and does not wedge the session | 7         |
      | BL-696-telegram-cursor-bridge-operator-commands.feature | /redeploy compiles and restarts the supervised bridge                       | 19        |
