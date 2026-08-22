# BL-788 architect bounce — 2026-08-13

## Commit reviewed
`dab934b69d215dd882183ffbbf1a963cca6c6ef2` (cleaner's merge of coder's
`11a07f9706a9f5b59d8c13460d3a09e29071cf92`), merged into architect at
`3f125ca91`.

## Review completed (Article 4.4 — full inventory, one bounce)

- Dependency-rule gate (`node extension/out/tools/dependency-gate.js` on the
  three changed TS files): **PASSED**, no forbidden edges.
- Co-change coupling report (`node extension/out/tools/co-change-report.js`
  on the same three files): `bridgeServer.ts`'s heavy coupling is pre-existing
  hub structure (already being worked down, e.g. BL-866's route extraction),
  not new coupling introduced by this parcel. Informational only, no action.
- Unit tests: `extension/test/bridgeServer.test.js` +
  `extension/test/residentSpyTunnelNotify.test.js` — 127/127 green.
- Declared invariant 1 (namespace-claim never serves outside the public dir)
  and invariant 2 (bridge's applicationId never drifts from
  `build.gradle.kts`): both have property tests in
  `extension/test/bl788BubblePairingInvariants.property.test.js`, run green
  (3/3), and are non-vacuous (a "concrete cases" test proves the traversal
  examples are actually blocked and a spoofed `package=` cannot leak into the
  intent href).
- Feature file (`specs/features/BL-788-bubble-pairing-client-logs-adopt.feature`,
  8 scenario instances) and its step handlers
  (`specs/pipeline/steps/bl788BubblePairingClientLogsAdoptSteps.js`) drive the
  real compiled bridge/tunnel-notify modules, wired into
  `specs/pipeline/steps/index.js`. `required_wiring` entries all verified
  present: the pre-auth APK route and `intent://pair` link are in the real
  bridge (not a helper nobody calls), the feature file exists, and
  `docs/index.md` links the how-to.
- The three approval-gated corrections the ticket asked for (applicationId
  rename, release signing decision, local-engineering Rule 7 correction) were
  each verified NOT stale-but-skipped: current `main`'s
  `android/app/build.gradle.kts` already carries `applicationId =
  "com.swarmforge.float"` (a later, independent hotfix superseded the
  ticket's proposed rename) with no `signingConfig` on `release`, and
  `local-engineering.prompt`'s Rule 7 no longer contains the stale
  "floatcompanion may stay" parenthetical (rewritten by the later
  Telegram/Cursor naming amendment). All three claims check out against
  current `main`.
- `CompanionPrefs.save` now delegates to `PairingSave.merge`; grepped for
  every other writer of `KEY_BASE_URL`/`KEY_TOKEN` — the only other write
  path (`hydrateFromDurableBackup`) is a distinct, pre-existing, already
  blank-safe flow (only fires when both stored fields are already blank, and
  only writes non-blank backup fields). No bypass of invariant 3 found.
- Route ordering / correctness read: `tryServeSideloadApk` and
  `tryServePairPage` are both positioned ahead of the generic 401 gate, in
  the pre-auth section; the namespace-claim logic 404s a
  pattern-mismatching request without ever touching the filesystem. No
  correctness defect found in the TypeScript/bridge side.

## D1 — invariant-unencoded: declared invariant 3 has no property test

**Declared invariant** (ticket YAML): "A pairing save never overwrites a
stored credential with a blank one; absent input leaves the stored value
standing."

**What shipped**: `android/app/src/main/java/com/swarmforge/floatcompanion/PairingSave.kt`
(the pure function this invariant is about — `PairingSave.merge`, no
`android.*` type in its signature) is covered ONLY by
`PairingSaveTest.kt`'s six example-based JUnit tests (fixed
blank/non-blank/whitespace combinations). No property test exists for this
invariant anywhere in the parcel, and no stated non-encodability reason
appears in the ticket, the coder's commit message, or the code comments.

**Why this is a real gap, not a nitpick**: `PairingSave.merge` is exactly the
shape of module this project's own established Kotlin property-testing
pattern targets — a pure, deterministic decision function tested via
`kotlin.random.Random` generation. Four sibling files in this exact codebase
already do this for analogous pure Kotlin decision functions:
`HandsFreeReArmGatePropertyTest.kt`, `VoiceEngineSelectorPropertyTest.kt`,
`BridgeBounceSessionPropertyTest.kt`, `ReplyPlaybackDecisionPropertyTest.kt`.
The six fixed examples happen to cover the blank/non-blank corners for two
fields, but they say nothing about arbitrary stored/input string content
(whitespace variants, unicode, punctuation that could confuse `normalizeUrl`,
etc.) — exactly the range a property test is for. Per this role's Invariants
Review section (BL-633/654): a missing property test for a declared
invariant is itself a send-back; the architect never hand-verifies the
property as a substitute for the missing test, and is never its first
author (that authorship rests with the coder).

**Remediation**: add `android/app/src/test/java/com/swarmforge/floatcompanion/PairingSavePropertyTest.kt`
following the existing `HandsFreeReArmGatePropertyTest.kt` /
`VoiceEngineSelectorPropertyTest.kt` pattern (`kotlin.random.Random` with a
fixed seed, `repeat(N)`), asserting invariant 3 holds for randomly generated
stored/input url/token strings — at minimum: blank or whitespace-only input
never changes the corresponding stored field; non-blank input always
replaces it (normalized/trimmed per `PairingSave`'s own rules). Prove it
non-vacuous (fails against a deliberately broken `merge` — e.g. one that
unconditionally overwrites — then restore), per this role's own
non-vacuousness discipline for property tests.

## Disposition

Bounced to **coder** (owns `PairingSave.kt` and its test coverage). Every
other check in this inventory passed; D1 is the only item.
