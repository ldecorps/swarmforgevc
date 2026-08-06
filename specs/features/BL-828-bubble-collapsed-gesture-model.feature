Feature: The collapsed Bubble arbitrates its own gestures

  Today one inline touch listener in OverlayService.attachDrag resolves a tap
  the moment ACTION_UP arrives with no movement, and that tap opens the Let's
  Talk panel. The human wants expand to be deliberate — double-tap — and the
  bubble itself to be push-to-talk: tap to open the mic, tap again to send.

  A tap is not known to be single until the double-tap window has expired, so
  the human ruled that the idle tap is held for that window and the mic starts
  slightly late. A tap while recording still sends immediately. That arbitration
  is pure logic with no android.* type in its own signature, so per the
  constitution's Testability Boundary — Bubble it is verified by the JVM unit
  suite. Real touch, the overlay window and the microphone are device surface
  and are verified by the manual procedure recorded in BL-828.

  Background:
    Given the Bubble Android module

  # BL-828 bubble-collapsed-gesture-model-01
  Scenario Outline: the gesture decider's arbitration is covered by the JVM unit suite
    When the JVM unit suite is run
    Then it exercises <decision>

    Examples:
      | decision                                                                    |
      | holding an idle tap until the double-tap window has expired                 |
      | starting the mic when the double-tap window expires with no second tap      |
      | expanding the panel when a second tap arrives inside the window             |
      | cancelling the held mic start when the expand fires                         |
      | sending immediately when a tap lands while recording                        |
      | expanding when a second tap follows a send inside the window                |
      | resolving a pointer that exceeds touch slop as a drag and never as a tap    |
      | leaving long-press pause and drag-to-teardown outcomes unchanged            |
