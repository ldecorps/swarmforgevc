# BL-826 — hardener pass

## Received

`git_handoff` from architect, commit `6666ace41d` (merge_and_process, task
`BL-826-first-poll-cadence-underflow`) — the architect's independent recheck
of D1 (first-poll cadence underflow bounce), verdict FIXED, no new defects.
Merged into `swarmforge-hardender` (merge commit on top of `a0838f02`).

## Tooling posture (constitution: Startup Tools — Kotlin row)

This parcel is `.kt`-only. No Kotlin mutation/CRAP/DRY tool is pinned in this
project (BL-472, deliberately deferred). Degraded posture applied and
recorded, not silently assumed clean:

- **Mutation**: no `.kt` mutation tool. Ran BL-113 Gherkin acceptance
  mutation instead — the feature uses `Scenario Outline` + `Examples`, so
  this is a real, applicable mutation gate (not the BL-638 `inapplicable`
  case). Also ran a hand-authored empirical mutation check (BL-638 posture)
  against `HandsFreeReArmGate.firstPollDelayMs` directly, since it had no
  isolated unit test before this pass — see below.
- **CRAP**: not wired for `.kt`. Not run.
- **DRY**: not wired for `.kt`. Not run; re-confirms the cleaner's read
  (`attachEchoHardening`/`releaseEchoHardening` are structurally similar but
  not meaningfully duplicative — left as-is).

## Coverage-gap hardening (fallback for the missing Kotlin mutation tool)

Found one real gap: `HandsFreeReArmGate.firstPollDelayMs` (the bounce D1 fix)
had no test calling it directly and asserting its own two-branch contract —
it was only exercised indirectly, buried inside the property test's
multi-hundred-line two-tier poll simulation. Added two direct unit tests to
`HandsFreeReArmGateTest.kt`:

- `first poll delay is the steady poll cadence when a quiet tail is being awaited`
- `first poll delay is the caller's cooldown when there is no tail to await`

**Empirically verified these (and the existing property test) actually kill
a mutant**, not just reasoned about it: hand-mutated
`firstPollDelayMs`'s `if (followsPlayback) … else …` to
`if (!followsPlayback) … else …` (inverting the branch — the exact bug class
the D1 bounce fixed) and re-ran
`./gradlew :app:testDebugUnitTest --tests "com.swarmforge.floatcompanion.HandsFreeReArmGate*"`.
Result: 1 failure (`first poll tick samples at the steady cadence, closing
the two-tier blind window`, `HandsFreeReArmGatePropertyTest.kt:179`) — killed
by the existing property test even before my additions. Reverted the mutant
immediately (confirmed `git diff` clean on the file before proceeding). The
two new direct tests give the same fault an isolated, fast-failing home
instead of relying solely on the property sweep to surface it.

No other coverage gaps found: `HandsFreeReArmGate.decide()` and
`isWithinSettleWindow()` are already covered by 8 example-based tests plus a
500-iteration randomized property sweep with two non-vacuity proofs (a gate
missing the ceiling clamp, and the pre-fix cooldown-sampling behavior, both
demonstrated to fail the relevant property). `AudioTurnRecorder`,
`ReplyAudioPlayer`, `TalkEngine` additions are the thin `android.*` device
edge (Testability Boundary — Bubble) — not unit-testable in this project's
posture, correctly left to the manual device procedure already recorded in
the ticket's `verification:` block.

## BL-113 Gherkin acceptance mutation (soft, first run for this feature)

```
$ specs/pipeline/scripts/run_gherkin_mutation.sh \
    specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature
outcome: pass
Total 6, Killed 6, Survived 0, Errors 0
```

All six `<decision>` Examples mutated and killed — each mutated value fails
`bl826BubbleHandsFreeSelfListenEchoLoopSteps.js`'s `KNOWN_DECISIONS` lookup
(`unknown <decision> example`), confirming the step handler's explicit
KNOWN_VALUES map has no passthrough (BL-233) and every example value is
load-bearing. Manifest embedded in the feature file (`# mutation-stamp`,
`# acceptance-mutation-manifest-begin/end`) per BL-460/BL-502 discipline —
this is the feature's first mutation run, so no prior stamp existed to soft-skip.

## Verification

```
$ JAVA_HOME=/usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
    ./gradlew :app:testDebugUnitTest --console=plain
BUILD SUCCESSFUL — 15 HandsFreeReArmGate*.kt tests (13 existing + 2 new), full module suite green.

$ specs/pipeline/scripts/run_acceptance.sh \
    specs/features/BL-826-bubble-hands-free-self-listen-echo-loop.feature
# tests 6, pass 6, fail 0
```

Host load was ~150 on 4 cores throughout this pass (other worktrees' live
runs); targeted gradle runs and the Gherkin mutation's per-mutant gradle
invocations completed successfully despite it, so no fallback to
office-hours deferral was needed for this `.kt`-only parcel (no Stryker/JS
mutation is in scope here regardless).

## Scope hygiene (BL-506)

`git diff --name-only af1d8b57 6666ace41d` (received delta): only
`HandsFreeReArmGate.kt`, `TalkEngine.kt`,
`HandsFreeReArmGatePropertyTest.kt`, the ticket YAML, and two evidence files
— consistent with the architect's own scope note. My own changes this pass:
`HandsFreeReArmGateTest.kt` (2 new tests) and the feature file (mutation
manifest only, tool-written). `swarmforge/scripts/operator_path_lib.sh`
(untracked, matches paused BL-796) left untouched — not this ticket's scope.

## Verdict

No defects found. One coverage gap closed (direct test for the D1 bounce
fix's `firstPollDelayMs`, empirically confirmed to catch the fix's own bug
class). Gherkin acceptance mutation run for the first time on this feature:
clean, 6/6 killed. Forwarding to documenter.

By hardender.
