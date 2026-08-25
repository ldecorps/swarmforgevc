# Collapsed-bubble gesture model (BL-828)

From the collapsed Bubble overlay (BL-707), expand is deliberate and talk
lives on the bubble itself — not "every tap opens the panel."

## Gestures

| Gesture | Effect |
|---|---|
| Single tap while idle (READY / ERROR) | Held for one platform double-tap window (`ViewConfiguration.getDoubleTapTimeout()`, typically ~300 ms). If no second tap, mic opens / recording starts; panel stays collapsed. |
| Double-tap (second tap inside the window) | Expands the Let's Talk panel; the held mic start is cancelled — never both. |
| Single tap while RECORDING | Stop and send immediately (no deferral). A fast second tap may still expand; the send is not retracted. |
| Long-press | Pause / resume all — unchanged. |
| Drag / drag-to-X | Move + magnet / teardown — unchanged. A pointer past touch slop is never a tap or half of a double-tap. |

Mic permission failure from a collapsed tap shows a **toast** (no silent
no-op). Panel Record/Stop behaviour is unchanged once expanded.

## Why the idle tap is late

A tap is not known to be single until the double-tap window expires. The
human ruled: delay the idle mic start one window so double-tap can expand
(mic starts slightly late). Recording taps stay immediate so every send is
not lagged 300 ms.

## Pure decider

Arbitration lives in `BubbleGestureDecider` (no `android.*` in its own
signature). `OverlayService` converts `MotionEvent`s and performs effects;
mic/send routes through existing `TalkEngine.onRecordClicked`.

JVM coverage: Scenario Outline in
`specs/features/BL-828-bubble-collapsed-gesture-model.feature` (8 decisions).
Device surface (real touch / overlay / mic) is the ticket's recorded manual
procedure — QA on a paired phone.

## Related

- [Android floating overlay companion](BL-707-android-floating-overlay-companion.md)
- [Running Bubble's JVM unit suite](BL-769-android-jvm-unit-suite.md)

Acceptance:
`specs/features/BL-828-bubble-collapsed-gesture-model.feature`
