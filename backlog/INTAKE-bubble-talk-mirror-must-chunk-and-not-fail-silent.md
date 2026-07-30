# Raw intake — Bubble talk mirror must chunk and must not fail silent

Status: new intake, not minted. Normal defect, not expedite.

Trigger
- Human via Let's Talk 2026-07-30, after Bubble topic proved reachable by a
  direct hand-posted audio message (Thanatos chiptune preview).
- Automatic mirror of spoken Let's Talk turns into the standing Bubble topic
  is unreliable. Conversation text still shows on the Cursor Remote host
  topic, while Bubble does not get a clean You / Bubble transcript.

## Goal

Every successful Bubble / Let's Talk turn leaves a durable Telegram transcript
in the Bubble topic. Mirror delivery must be loud on failure and must survive
long replies.

## Problem today

- Design intent: talk dumps mirror to Bubble; Cursor Remote stays for slash
  verbs / typed remote control.
- Implementation: `mirrorLetsTalkTurnToBubble` is best-effort. Failures are
  swallowed so the phone turn still succeeds.
- Unlike Cursor Remote posting, the Bubble text mirror does not chunk long
  replies. Over-limit Telegram sends fail quietly.
- Result: human hears Bubble on the phone, sees talk text on the host topic,
  and does not get a single reliable Bubble-topic transcript.
- Hand posting into Bubble works, so the topic binding itself is fine. The
  automatic mirror path is the defect.

## Requested outcome

1) On every successful Let's Talk turn, post `You:` / `Bubble:` text into the
   Bubble topic (not Cursor Remote).
2) Chunk long replies the same way Cursor Remote posting already chunks, so
   length alone cannot drop the mirror.
3) If mirror send fails after retries, surface a loud failure (log + operator
   or Bubble alert). Do not fail silent.
4) Choice polls keep working in Bubble; text mirror must be at least as
   reliable as poll mirror.
5) Cursor Remote must not remain the accidental dump for ordinary talk turns.

## Acceptance shape to refine

1) A short talk turn appears in Bubble as You / Bubble within a bounded time.
2) A long talk reply (over Telegram's single-message limit) still appears in
   Bubble as multiple chunks, in order, with no silent drop.
3) Forcing a mirror send failure produces a surfaced error; the human can tell
   the transcript did not land.
4) Cursor Remote does not receive the ordinary talk dump for those turns.
5) Direct hand posts to Bubble remain possible; this ticket fixes automatic
   mirror only.

## Non-goals

- Not expedite / ambulance.
- Not redesigning hold music or TTS.
- Not merging Bubble and Cursor Remote into one topic.

## Related

- Silent return after hold music intake (speech playback gap) — separate.
- BL-696 / Bubble how-to: successful turns mirrored best-effort to Bubble.
- Direct Bubble send of Thanatos approx audio proved topic  binding works.
