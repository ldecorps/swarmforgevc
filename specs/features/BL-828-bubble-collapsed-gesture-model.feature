# mutation-stamp: sha256=404e331fa47ca1171998a2535cfab68377f366d397ebb330a940282a5f49adcd
# acceptance-mutation-manifest-begin
# {"version":1,"tested_at":"2026-08-25T18:36:35.168877775Z","feature_name":"The collapsed Bubble arbitrates its own gestures","feature_path":"/home/carillon/swarmforgevc/.worktrees/hardender/specs/features/BL-828-bubble-collapsed-gesture-model.feature","background_hash":"c23bd1348caf861a59da975037237b60841e59bddd56bf51d813886c8fc1feae","implementation_hash":"unknown","scenarios":[{"index":0,"name":"the gesture decider's arbitration is covered by the JVM unit suite","scenario_hash":"175cfcb455d9ad82088b4d37c930f7c062aef961d2d222055556684ef1e7c114","mutation_count":8,"result":{"Total":8,"Killed":8,"Survived":0,"Errors":0},"tested_at":"2026-08-25T18:36:35.168877775Z"}]}
# acceptance-mutation-manifest-end

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
