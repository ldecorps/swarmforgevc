# BL-717 architect bounce — 2026-08-09

## Reviewed commit

`6bed2963ab` "BL-717 D1: fall back when a non-blank reply transforms to
blank speech" (By coder; the fix for cleaner's earlier D1 bounce,
`backlog/evidence/BL-717-bubble-silent-return-after-hold-music-bounce-20260809.md`),
on top of the ticket's original `95185e43` "BL-717: never end a hold-music
turn in silence".

## Review pass — complete inventory (Article 4.4)

- Dependency-gate hard gate (`extension/out/tools/dependency-gate.js
  src/bridge/letsTalkCore.ts src/bridge/letsTalkRoutes.ts`, run under Node
  22 — the repo's default Node 20.20.2 is below dependency-cruiser's
  supported floor, `^22||^24||>=26`; not a parcel defect, an environment
  gap worked around for this review): `Dependency-rule gate PASSED: no
  forbidden edges.` PASS.
- Co-change (`extension/out/tools/co-change-report.js` on the same two
  files): all "SUSPECTED COUPLING" hits are pre-existing lets-talk
  bridge/test siblings (letsTalkRoutes.ts, the two test files,
  letsTalkAudio.ts, letsTalkUiHtml.ts, etc.) — expected, matches the
  cleaner's own note that these are large pre-existing shared modules. No
  new/unexpected coupling. Informational only.
- Kotlin JVM unit suite (`cd android && JAVA_HOME=<homebrew openjdk@17>
  ./gradlew :app:testDebugUnitTest --tests
  "com.swarmforge.floatcompanion.ReplyPlaybackDecision*"
  -Dsdk.dir=<repo-root>/.swarmforge/android-sdk` — this worktree's own
  `android/local.properties` points at the main checkout's SDK path, which
  does not exist inside `.worktrees/architect`; overridden for this run,
  not a parcel defect): `BUILD SUCCESSFUL`,
  `ReplyPlaybackDecisionPropertyTest` 4/4 and `ReplyPlaybackDecisionTest`
  9/9, all passed, 0 failures/errors. Covers invariant 1 (no terminal
  branch silent) and invariant 3 (bounded recovery — "recovery never chains
  past one extra speech attempt" ran 1,000 iterations, passed). PASS.
- TS unit suites (`npx vitest run --config vitest.config.mjs
  letsTalkCore.test.js letsTalkBridge.test.js`): 58/58 passed, including the
  new D1-fix example tests (punctuation-only reply, blank reply,
  untouched-real-reply cases). PASS.
- Gherkin acceptance
  (`specs/features/BL-717-bubble-silent-return-after-hold-music.feature`,
  unmodified by this parcel): 8/8 scenarios pass via
  `node specs/pipeline/cli.js`. Scenario 04 ("the fallback never replaces a
  real reply") only drives the Kotlin-side `ReplyPlaybackDecisionTest`/
  `PropertyTest` (device half) — it does not reach the TS-side property
  test below, so it does not catch D1.
- `depends_on: []` — no landing-order constraint. N/A.
- `human_approval: approved` on the ticket. Confirmed present.

## D1 — invariant-2 regression: `resolveSpeakableReply` now overwrites a
     real, non-blank `replyText` (class: behavior, blamed: coder)

**Declared invariant 2** (`backlog/active/BL-717-...yaml`): "The fallback
line is spoken only when no real speakable reply is available; it never
masks, truncates, or replaces a reply that could have played."

The D1 fix's own pre-existing property test,
`extension/test/bl717ReplySilenceInvariants.property.test.js` (written in
the ORIGINAL `95185e43` commit, untouched by `6bed2963ab`), encodes this as:
for every non-blank `replyText`, `result.replyText` must equal the original
`replyText` exactly — never the fallback line (line 56: `'a real reply must
never be replaced by the fallback line'`). This property was passing before
`6bed2963ab` (cleaner's own bounce evidence names only the OTHER property in
the same file, the client-TTS `replySpeechText`-non-blank one, as failing).

`6bed2963ab`'s `resolveSpeakableReply` (letsTalkCore.ts:313-326) now returns
the FULL fallback object — both `replyText` AND `speechText` — whenever the
speech-transformed text reduces to blank, not just the speech half. That
over-corrects: it fixes the speech-text-blank case by widening the
substitution to the *displayed* `replyText` too, which the already-existing
property forbids for any non-blank input.

**Deterministic repro** (not a flaky property run — reproduces on every
invocation, not just the fast-check-found `"/"` counterexample):

```
$ node -e "
const { resolveSpeakableReply } = require('./out/bridge/letsTalkCore');
console.log(JSON.stringify(resolveSpeakableReply('/')));
"
{"replyText":"I don't have anything to say about that.","speechText":"I don't have anything to say about that."}
```

A real agent reply of `"/"` — non-blank, a reply the property test's
existing contract says must survive untouched in `replyText` — is
completely replaced, on screen too, by the generic fallback line.

**Failing test** (already in the parcel, not newly added by me):
```
$ npx vitest run --config vitest.properties.config.mjs bl717ReplySilenceInvariants.property.test.js
✓ property: client-TTS mode always carries non-blank replySpeechText alongside a successful turn
✓ non-vacuity: without the fallback substitution, a blank reply violates the property
✗ property: a successful turn never carries a blank reply, and a real reply is never replaced by the fallback
  Counterexample: ["/","client"]
  Expected: "/"
  Received: "I don't have anything to say about that."
```

1 of 3 tests in the file fails — the commit message's claim ("The
already-failing property test ... now passes") is true only for the one
property named in cleaner's bounce evidence; the other, pre-existing
property in the same file was not re-run before forwarding and is now
broken by this same fix.

**Why cleaner/coder's own verification missed it**: the D1 fix commit
message names only the specific property cleaner's bounce evidence flagged
as failing. The property test file's OTHER test (the one that now fails)
was passing before the fix and was not re-checked after it — an
already-green check silently regressed by a fix aimed at a different
property in the same file.

**Remediation** (left to coder's judgment per the ticket's `notes:` framing
of "no real speakable reply is available" as the operative line): keep
`replyText` as the original, non-blank agent reply whenever it IS non-blank
— substitute the fallback into `speechText` only, never into the displayed
`replyText`, when `replyTextForSpeechSynthesis` reduces a non-blank reply to
nothing pronounceable. That satisfies both the original D1 finding (client-TTS
`replySpeechText` must be non-blank) and this pre-existing property (a real,
non-blank reply's `replyText` must never be replaced) simultaneously —
`LetsTalkSpeakableReply` already has separate `replyText`/`speechText`
fields, so the two no longer need to move together. Re-run the FULL
`bl717ReplySilenceInvariants.property.test.js` file (not just the property
the prior bounce named) before forwarding again.

**Blocked checks**: none — every check this pass owns ran to completion.

## Inventory

- D1 (above): behavior / coder / extension/src/bridge/letsTalkCore.ts
  `resolveSpeakableReply`.

No other defects found in this review pass.
