# How to use Let's Talk floating minimize (BL-706)

On the Let's Talk Mini App screen, tap **Minimize** to collapse the full page
into a round chat-head bubble (~64px mic face). The bubble stays on screen and
remains speakable on the same discrete turn loop (record → reply playback).

## Floating bubble

- Tap the **mic** face to record / stop.
- Tiny **pause** and **expand** dots sit under the head.
- Drag the head to reposition; position is remembered.
- Minimized mode is restored after reload when you left it minimized.

Not a system picture-in-picture or overlay over other Telegram screens — that
needs the native Android companion. Inside the Mini App WebView, talk chrome
stays visible. See the main Let's Talk how-to:
[BL-696](BL-696-miniapp-lets-talk-cursor-audio.md).

Acceptance: `specs/features/BL-706-lets-talk-floating-minimized-chat.feature`.
