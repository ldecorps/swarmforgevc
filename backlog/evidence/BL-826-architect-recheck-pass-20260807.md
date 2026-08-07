# BL-826 — architect recheck pass (post-bounce, 2026-08-07)

## Received

`git_handoff` from cleaner, commit `2f8130b342` (merge_and_process, task
`BL-826-first-poll-cadence-underflow`). This is the cleaner's recheck of the
coder's fix (`54828841e8`) for my own bounce recorded at
`backlog/evidence/BL-826-bounce-20260807.md` (D1: the first hands-free re-arm
poll sampled at the wider cooldown instead of the steady poll cadence).
Fast-forward merged into `swarmforge-architect`.

## D1 remediation check

Remediation asked for: make the first poll tick fire at
`HandsFreeReArmGate.DEFAULT_POLL_INTERVAL_MS`, not
`AudioTurnRecorder.HANDS_FREE_POST_SPEECH_MS`, on the `followsPlayback = true`
path only, plus a regression test exercising `TalkEngine`'s actual scheduling
(not just the pure `decide()` function).

Verified by reading, not assumed:
- `HandsFreeReArmGate.firstPollDelayMs(cooldownMs, followsPlayback,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS)` returns `pollIntervalMs` when
  `followsPlayback`, else `cooldownMs` — exactly the asymmetry asked for.
- `TalkEngine.kt::scheduleHandsFreeListen` now calls
  `mainHandler.postDelayed(r, HandsFreeReArmGate.firstPollDelayMs(delayMs,
  followsPlayback))` in place of the old `postDelayed(r, delayMs)`.
- Grepped every `scheduleHandsFreeListen` call site
  (`TalkEngine.kt:111,236,269,345,397,409`): only line 409
  (`onPlaybackDone`, `followsPlayback = realPlaybackOccurred`) can pass
  `followsPlayback = true`; the other five keep the default `false` and so
  keep their existing cooldown-timed single check, unchanged — matches "
  `followsPlayback = false` call sites are unaffected" from my own
  remediation pointer.
- New test `first poll tick samples at the steady cadence, closing the
  two-tier blind window` mirrors `TalkEngine.HandsFreeListenPoll.run()`'s
  actual two-tier schedule (first tick at `firstPollDelayMs`, later ticks at
  `decide()`'s own `recheckAtMs`) — this is the TalkEngine-scheduling-shaped
  test my remediation pointer asked for, not just another call into the pure
  `decide()` function in isolation.
- Non-vacuity: a second test hardcodes `firstPollDelayMs = cooldownMs` (the
  pre-fix behavior) against the bounce evidence's exact 390ms audio-end /
  400ms cooldown scenario and asserts the property fails there — proves the
  regression sweep exercises the fix rather than passing by construction.

D1: **FIXED**.

## Independent re-verification (not trusted from coder/cleaner evidence alone)

- `JAVA_HOME=/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home
  ./gradlew :app:testDebugUnitTest --tests
  "com.swarmforge.floatcompanion.HandsFreeReArmGate*"` — BUILD SUCCESSFUL.
  `TEST-…HandsFreeReArmGatePropertyTest.xml`: `tests="5" failures="0"
  errors="0"`, both new tests present and green.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature` —
  6/6 pass.
- `git diff --name-only af1d8b57 2f8130b3`: only
  `HandsFreeReArmGate.kt`, `TalkEngine.kt`,
  `HandsFreeReArmGatePropertyTest.kt`, the ticket YAML's bounce record, and
  the cleaner's own evidence file. No `.ts`/`.js` file touched, so the
  dependency-gate / co-change tools (TS-scoped) remain out of scope — same
  conclusion as my original bounce evidence, unaffected by this delta. Scope
  hygiene (BL-506): clean.
- Invariant 1 ("no path arms the mic while Bubble's own audio can still
  reach it"): D1 was the concrete threat to this invariant in the
  variable-TTS-tail scenario; now closed to the size of one poll step
  (150ms), the smallest gap a discrete sampler can offer, as the fix commit
  itself argues. Invariant 2 (bounded-ceiling resolution): untouched by this
  delta, still property-tested and green.
- `required_wiring` items: both unaffected by this delta (neither touched
  file removes or bypasses the call-site funnel or the echo-canceler
  attachment verified in the original pass).

## Verdict

Bounce D1 resolved. No new defects found. Forwarding to hardener.

By architect.
