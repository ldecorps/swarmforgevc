# Raw intake — Bubble hands-free self-listen / echo loop

Status: new intake, not minted.

Goal
- Stop hands-free Bubble from re-opening the mic onto its own spoken reply.
- Stop the self-feeding loop where Bubble treats its TTS or reply audio as a new human turn.
- Keep hands-free usable with slow TTS voices and speaker lag.

Problem
- Hands-free waits a short fixed delay after "playback done", then opens the mic.
- That done signal can fire while audio is still in the speaker path (slow TTS, OEM lag, buffer tail).
- The mic then hears Bubble's own voice, silence-auto-submit treats it as a turn, and Bubble answers again.
- Loop never ends cleanly: Bubble listens to itself and believes it is the human.

Why this matters
- Hands-free becomes unusable when the loop latches.
- Slow voices make the fixed post-speech gap too short more often.
- This is opposite to healthy turn-taking: agent speech must not count as user input.

Requested outcome
- While Bubble is still audibly speaking, mic must not treat that audio as a human turn.
- After real speech end, wait long enough for speaker / room tail before listening.
- Prefer cheap, reliable guards over full speaker identification first.
- Optional later: reject turns whose transcript closely matches the just-spoken reply.
- Do not require the human to disable hands-free to recover.

Suggested guardrails (specifier to pick)
1) Lengthen and/or make adaptive the post-speech re-arm delay (today ~400 ms is too short for slow TTS).
2) Treat playback as unfinished until TTS or MediaPlayer reports done AND a short quiet tail.
3) On mic re-arm, ignore leading audio for a brief settle window (or require fresh speech after quiet).
4) Keep or harden acoustic echo path (VOICE_COMMUNICATION / AEC) so speaker bleed is attenuated.
5) Soft reject: if STT text is near-identical to the last spoken reply, drop and re-listen instead of submitting.
6) Speaker ID / "only my voice" is optional later — useful but heavier than the loop fix.

Conflict note
- Existing intake wants barge-in while Bubble speaks. That must not reintroduce self-listen.
- Barge-in, if built, needs a human-vs-playback discriminator; pure "mic always open during SPEAKING" is unsafe.

Acceptance shape to refine
1) With hands-free on, a long slow TTS reply does not auto-submit a follow-up turn from its own audio.
2) After a normal reply, mic re-arms only once speech is truly finished plus a safe tail.
3) Human speech after that tail still starts a turn as today.
4) No infinite self-answer loop without human speech.
5) Pause-all / mute still stops the loop immediately.

Notes from human request (Let's Talk, 2026-07-31)
- Human observes mic re-arming too early while Bubble is still talking.
- Different TTS speeds make a fixed delay fail.
- Bubble hears itself, thinks it is the human, and restarts — self-feeding.
- Human wonders about recognizing their own voice; open to other fixes that stop non-human audio counting as input.

---

## Specifier disposition 2026-07-31 — NOT drained, sequenced behind BL-761

Read and assessed. Blocked on a real finding, not on ambiguity: this repo has
no way to write an executable acceptance contract for Android device behavior.
There is no `test`/`androidTest` source set under `android/`, no JVM unit
suite, and the acceptance runner (`specs/pipeline`) is Node and cannot reach
Kotlin. Measured 2026-07-31: BL-707 runs 0 of 6 scenarios, BL-706 0 of 4,
BL-718 0 of 6, BL-696 3 of 8 — all shipped, all "no step handler matched".

Speccing another Bubble ticket today would mean writing one more inert
acceptance contract, which is precisely the defect BL-727 and BL-761 exist to
stop. BL-761 (`backlog/paused/`) specs the gate and names the Android-seam
policy as its own out-of-scope sequencing hazard.

Resume point: once the Android-seam policy is settled (where device behavior
is verified, given it cannot ride the Node acceptance runner), spec these
against it. The behavior captured above is clear and needs no further
questions — only a place to put its contract.

---

## DRAINED 2026-08-06 — BL-826

The 2026-07-31 disposition above named its resume point: "once the Android-seam
policy is settled … spec these against it." BL-769 and BL-761 are now in
`backlog/done/M8/` and the policy is in the constitution as local-engineering's
"Testability Boundary — Bubble (Android)". Blocker cleared, intake drained.

- `backlog/paused/BL-826-bubble-hands-free-self-listen-echo-loop.yaml` —
  `type: defect`, `severity: high`, with
  `specs/features/BL-826-…feature` bound to the BL-769 gradle JVM seam plus a
  recorded manual procedure for the device surface.

Probed before speccing: the account here is accurate and the code is slightly
worse than described. `HANDS_FREE_POST_SPEECH_MS = 400L`, and the auto-submit
rule (`MIN_RECORD_MS = 400L`, `HANDS_FREE_SILENCE_MS = 2500L`) means Bubble's
own tail need only hold the mic 400 ms and then go quiet 2.5 s to be submitted
as a human turn. `onPlaybackDone()` also fires from `Phase.THINKING`, so a
re-arm can be scheduled where no playback ever started — the ticket's gate
covers that path too.

Of the six guardrails this intake asked the specifier to pick from, BL-826
takes 1–4 (adaptive re-arm, quiet-tail gate, post-arm settle window, acoustic
echo hardening) and defers 5 (transcript match backstop) and 6 (speaker ID),
both recorded in the ticket's `out_of_scope` with the reasoning. The conflict
note against barge-in is honoured: BL-826 is priority 85, ahead of BL-777.

1:1 drain — deliberately not merged with the "hey bubble" wake intake, which is
new capability rather than a defect in shipped behaviour.
