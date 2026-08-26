Feature: Bubble stops speaking when the human starts speaking over it
  In hands-free mode Bubble currently keeps the mic closed while it speaks, so
  a long spoken reply cannot be cut short. This slice adds the detector and the
  abort: human speech overlapping active playback stops that playback promptly
  and leaves exactly one listening session open. It does not yet decide what
  happens to the task that was running — that is a later slice.
  Source: backlog/INTAKE-voice-barge-in-to-interrupt-and-resteer-bubble-speech.md.

  Background:
    Given Bubble is speaking a reply aloud

  # BL-776 barge-in-01
  Scenario: speaking over Bubble in hands-free mode stops it
    Given the voice mode is hands-free
    When the human starts speaking over the playback
    Then playback stops within the stop-latency budget
    And Bubble is listening

  # BL-776 barge-in-02
  Scenario Outline: only speech interrupts, not room noise
    Given the voice mode is hands-free
    When <sound> is picked up during playback
    Then playback <playback-outcome>

    Examples:
      | sound                            | playback-outcome |
      | speech above the onset threshold | stops            |
      | ambient noise below it           | continues        |
      | Bubble's own output alone        | continues        |

  # BL-776 barge-in-03
  Scenario: push-to-talk stays manual
    Given the voice mode is push-to-talk
    When the human starts speaking over the playback
    Then playback continues
    And Bubble is not listening until the mic is activated manually

  # BL-776 barge-in-04
  Scenario: an abort leaves exactly one listening session
    Given the voice mode is hands-free
    When the human barges in twice in quick succession
    Then exactly one listening session is open
    And no playback is still running
