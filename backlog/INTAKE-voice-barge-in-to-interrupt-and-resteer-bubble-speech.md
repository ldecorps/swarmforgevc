# Raw intake — Voice barge-in to interrupt and re-steer Bubble speech

Status: new intake, not minted.

Goal
- Let the human interrupt Bubble while it is speaking.
- Let the human immediately steer to a different request by voice.
- Keep continuous listening during background execution in hands-free mode.

Problem
- Current behavior turns the mic off while Bubble is speaking or processing.
- Human cannot cut in during long spoken output or while the agent is off doing a task.
- This creates control friction when priorities change mid-flight.
- This has happened more than once, so it is a recurring workflow gap.

Why this matters
- Voice control should feel live and interruptible, not turn-based only.
- Fast course correction reduces wasted work and waiting.
- Bubble should support collaborative steering in real time.

Requested outcome
- Human can vocally interrupt active Bubble speech at any moment.
- Interruption stops current spoken output quickly and reliably.
- Bubble listens for a new instruction right after interruption.
- New instruction can cancel, redirect, or replace the in-flight task safely.
- In hands-free mode, Bubble keeps listening while the agent is processing, so the human can re-steer before response return.
- In push-to-talk mode, interruption and re-steer remain manual via mic activation.
- Human can switch voice mode by voice command, including hands-free to push-to-talk and push-to-talk to hands-free.

Scope intent
- Voice interruption trigger and detection while speech is active.
- Immediate speech stop behavior with clean handoff back to listening.
- Continuous listening state during execution in hands-free mode.
- Voice intent handling for mode-switch commands.
- Task control semantics for cancel vs redirect.
- Bubble-first behavior, with consistent downstream state updates.

Acceptance shape to refine
1) In hands-free mode, while Bubble is speaking, human can barge in by voice and stop playback without waiting for completion.
2) In hands-free mode, Bubble remains listening while the agent is processing after voice input.
3) In hands-free mode, follow-up voice command can redirect the assistant before the original response returns.
4) In push-to-talk mode, interruption and redirection require manual mic activation.
5) Voice command can switch from hands-free to push-to-talk without opening settings.
6) From push-to-talk mode, user can press and speak a command to switch back to hands-free.
7) Interrupted task state is explicit: canceled, paused, or superseded, with no hidden continued execution.
8) No stuck mic states, overlapping audio, or duplicate responses after interruption.

Open design questions
1) Should interruption require a wake phrase, keyword, or pure VAD overlap?
2) What is the max allowed stop latency for speech cut-off?
3) Should hands-free listening during execution be always-on or constrained by timeout windows?
4) Which command phrases are canonical for mode switching, and how strict should matching be?
5) Should mode-switch commands require confirmation to avoid accidental toggles?
6) If background work has side effects, what is the safe cancel boundary?
7) Should there be a verbal confirmation before abandoning the previous task?
8) How should this behave when interruption occurs during remote tool execution?

Suggested slice candidates
- Slice A: Speech barge-in detector and playback abort.
- Slice B: Mic state handoff and rapid re-listen loop.
- Slice C: Voice mode-switch command handling for both directions.
- Slice D: Task lifecycle transitions for interrupt, cancel, and redirect.
- Slice E: UX confirmations and guardrails for side-effecting tasks.
- Slice F: Reliability checks for race conditions across speech and execution states.

Notes from human request
- Human wants to interrupt in-flight speaking and immediately steer by voice.
- This is positioned as Bubble functionality, not just transcript visibility.
- Interruption and always-listening behavior are intended for hands-free mode only.
- Push-to-talk remains manual by design.
- Human also wants voice-driven mode switching in both directions.

---

## Specifier disposition 2026-07-30 — NOT drained, question asked

Read and assessed; deliberately left in the root. Each of this intake's open
design questions changes the shape of slice A materially (e.g. for barge-in,
"wake phrase vs keyword vs pure VAD overlap" is the slice), so speccing now
would mean guessing rather than asking.

One clarifying question covering the disposition of all three is now PENDING in
the specifier's Telegram topic: mint each as epic + slice A with
`human_approval: pending` and specifier-chosen defaults, hold all three as
capture-only, or mint voice-barge-in only.

Raising it first required clearing a stale marker: `role_ask.bb` allows ONE
pending question per role, and the specifier's slot had been held since
2026-07-25 by a question about BL-687 that shipped past it (approved 2026-07-27,
`b2edcf681`) — so nothing would ever have cleared it. See BL-687's `notes:`.

Resume point: act on the answer when it arrives. Do not re-ask.
