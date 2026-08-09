# BL-826 bubble-hands-free-self-listen-echo-loop — documenter pass — 20260809

Commit reviewed: `bd2833f9` (hardener's forward, `merge_and_process hardender
bd2833f9cf`), which carries architect's `5b992d3c` (verdict: clean) and
coder's `066fd1ab` (acceptance step handlers only). Merged into this branch
before this pass ran (ancestry confirmed via `git merge-base --is-ancestor
bd2833f9cf HEAD`).

## What changed

A defect fix for the Bubble Android app's hands-free mode: the mic used to
re-arm a fixed 400 ms after the playback-done signal regardless of whether
Bubble's own reply audio was still audible, so a slow TTS voice's tail could
be captured, auto-submitted, and answered — a self-feeding loop. The
production fix (`HandsFreeReArmGate.kt`, plus wiring in `TalkEngine.kt` and
`AudioTurnRecorder.kt` — adaptive quiet-tail re-arm, a post-arm settle
window, and `AcousticEchoCanceler`/`NoiseSuppressor` hardening) landed
earlier via an out-of-band operator/Cursor commit (`2e65b769`), predating
this pipeline run. This parcel's own commits (coder, cleaner, architect,
hardener) added only the missing acceptance-test wiring for that
already-landed code — six step-handler scenarios bound to the real Gradle
JVM unit suite (BL-769 seam) plus a cleaner DRY extraction shared with
BL-769's step handlers. No further production code changed in this parcel;
architect and hardener each independently re-verified the fix against the
ticket's `required_wiring` and invariants and found it clean.

## Doc surfaces checked

- `docs/how-to/BL-707-android-floating-overlay-companion.md` — the only
  human-facing doc describing hands-free behavior ("Hands-free — auto-listen
  after the reply finishes ... keeps listening while the panel is collapsed
  to the bubble"). This description was already the correct, intended
  behavior before the fix; it never documented the self-listen bug as
  expected behavior, so nothing here needs correcting. The fix makes the
  app's actual behavior match what this doc already promises — no wording
  change warranted.
- `docs/reference/specs/BL-697-lets-talk-hands-free-listening.md` — describes
  a *different* surface (the Mini App WebView's `letsTalkCore.ts`/
  `letsTalkUiHtml.ts` hands-free implementation, server route
  `POST /lets-talk/turn`), not the Bubble Android app's `TalkEngine.kt`. Not
  affected by this parcel.
- `docs/reference/Specification.MD` — grepped for `hands-free`/`self-listen`/
  `echo`: no mention of this failure mode or the gate mechanism. The
  hands-free capability itself was never specced there in this level of
  implementation detail (it lives in the BL-826/BL-769 ticket + feature
  file), so there is no stale claim to fix and it is not this defect-fix
  parcel's place to backfill a spec-level writeup.
- `docs/diagrams/architecture.mmd` / `docs/diagrams/swarm-flow.mmd` — neither
  diagram represents Android/Bubble internals (TalkEngine, AudioTurnRecorder,
  or the re-arm gate); this parcel adds no new component or boundary at the
  diagram's altitude. No diagram update warranted.
- No `CHANGELOG` file exists in this repo to update.

## Verdict

NONE. No human-facing documentation requires a change: the fix corrects
internal behavior to match what the existing how-to doc already describes,
and no other doc surface makes a claim this parcel makes stale.

## Forward

`git_handoff` to `QA`, priority `00`, task
`BL-826-bubble-hands-free-self-listen-echo-loop`.

By documenter.
