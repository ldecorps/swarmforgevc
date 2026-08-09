# BL-717 — cleaner bounce to coder (20260809)

## Review pass (cleaner)

- Cleanup applied: collapsed the duplicated `finished`/`!finished` branches in
  `ReplyAudioPlayer.isAudioActive()` (android/app/src/main/java/com/swarmforge/floatcompanion/ReplyAudioPlayer.kt)
  into a single `fallback` value — no behavior change, verified by inspection
  (each branch's catch/default value is identical to the corresponding
  original branch's).
- `extension/test/letsTalkBridge.test.js`: 32/32 passed.
- `npm run test:properties` (vitest.properties.config.mjs), scoped to the
  BL-717 property file: **1 of 3 failed** — see D1 below.
- `mutation-site-count.js` on the two changed TS files: both already `over`
  threshold (letsTalkCore.ts 558, letsTalkRoutes.ts 183) — pre-existing large
  modules, not created or materially grown by this parcel's diff (BL-717 adds
  ~10 lines total across both). Not treated as a split candidate for this
  parcel; noted, not blocking.
- Kotlin files (ReplyAudioPlayer.kt, ReplyPlaybackDecision.kt): mutation-site
  count tool has no `.kt` parser (documented gap, engineering rules
  "Kotlin/Android" tool-table entry) — not a gate today.

## D1 — functional defect (class: unit, blamed role: coder)

**Summary:** `replyTextForSpeechSynthesis()` (extension/src/bridge/letsTalkCore.ts)
strips punctuation-only content (markdown-active characters
`` [|#*_`~\[\]] ``) down to an empty string. When the agent's `replyText` is
itself just such content (e.g. `"|"`, `"###"`, `"***"`, `"~~~"`) — non-blank,
so BL-717's own empty-reply-fallback substitution in
`promptAgentAndSynthesize()` never triggers — the resulting `replySpeechText`
handed to client-TTS mode is blank. This is exactly the silent-turn failure
mode BL-717 exists to close, now reproduced one layer downstream of the fix:
`replyText` is non-blank so the fallback never fires, yet the phone speaks
nothing in client-TTS mode.

**Repro (deterministic, not a flaky property run):**
```
node -e "
const { replyTextForSpeechSynthesis } = require('./extension/out/bridge/letsTalkCore');
console.log(JSON.stringify(replyTextForSpeechSynthesis('|')));   // ''
console.log(JSON.stringify(replyTextForSpeechSynthesis('###'))); // ''
"
```

**Failing test (already in the parcel, coder-authored per BL-654):**
`extension/test/bl717ReplySilenceInvariants.property.test.js` — "property:
client-TTS mode always carries non-blank replySpeechText alongside a
successful turn". Counterexample found by fast-check: `replyText = "|"`.
Run via `npm run test:properties` (or `npx vitest run --config
vitest.properties.config.mjs bl717ReplySilenceInvariants.property.test.js`
from `extension/`).

**Why cleaner is not the fixer:** this is new functional behavior (deciding
what happens when a non-blank reply reduces to blank speech text), not a
readability/duplication/structure concern — outside cleaner's domain (Article
1.4 "Does Not Own: introduce new behavior"). The fix belongs with whichever
guard BL-717 intends here: apply the same empty-reply-fallback substitution
to the *speech-transformed* text in client-TTS mode (not just the raw
`replyText`), or treat blank-after-transform as another explicit-fallback
input to `ReplyPlaybackDecision`-equivalent logic on the bridge side. Left to
coder's judgment, matching BL-717's own invariant text ("no terminal branch
... is silent ... including branches added later").

**Blocked checks:** none — this is the only item found; all other checks
(cleanup verification, letsTalkBridge unit suite, mutation-site count) ran to
completion.

## Inventory

- D1 (above): unit / coder / extension/src/bridge/letsTalkCore.ts
  `replyTextForSpeechSynthesis` + extension/src/bridge/letsTalkRoutes.ts
  `clientTtsTurnSuccess`.

No other defects found in this review pass.
