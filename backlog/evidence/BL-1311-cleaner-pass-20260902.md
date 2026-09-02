# BL-1311 — cleaner pass

Commit: 37a0c0d51f (merge of coder 0f3e69ed03) · 2026-09-02 · worktree `cleaner`

## Review inventory — NONE found

- **Diff scope**: `bridgeServer.ts` (+11/-4), `letsTalkBridge.test.js` (+37),
  new `bl709BubbleOwnTelegramTopic.property.test.js` (+93). Read in full.
- **Fix shape**: new private `letsTalkMirrorTopicForPath` sibling next to the
  existing `bubbleMirrorTopicForPath` pattern, both call sites in
  `bridgeServer.ts` switched to it. `effectiveBubbleMirrorTopicId` /
  `bubbleMirrorTopicForPath` untouched, per invariant 2. No unused imports
  left behind (`bubbleMirrorTopicForPath` import removed, grep confirms zero
  remaining references in the file).
- **Coverage**: no uncovered changed behaviour — coder's evidence
  (`backlog/evidence/BL-1311-coder-pass-20260901.md`) already ran a manual
  non-vacuity check (reverted the resolver, confirmed the new regression
  test fails) in lieu of a mutation pass; re-verified the property + unit
  tests pass clean here.
- **CRAP**: re-ran `specs/features/BL-744*.feature` — 3/3, all six BL-718
  CRAP targets (including the two touched functions) still <=6.
- **DRY**: `npx jscpd src/bridge/bridgeServer.ts` — 2 clones (lines
  726-741/823-838 and 1147-1154/1261-1268), both pre-existing and nowhere
  near the changed lines (118-192); this parcel introduces no new
  duplication.
- **Mutation-site size (BL-485)**: `mutation-site-count.js` on
  `bridgeServer.ts` reports 1823 sites, `over` the 100 threshold. This is a
  pre-existing large file (not created by this parcel) and the change here
  is a 4-line resolver swap plus one 3-line wrapper function. A split would
  not improve structure for this fix and risks unrelated churn — advisory
  only, no split taken, per the "legitimately-cohesive large module a split
  would only harm stays whole" guidance.
- **Architecture**: `letsTalkMirrorTopicForPath` sits beside the pre-existing
  `effectiveLetsTalkMirrorTopicId` it wraps (same file, same reasoning as
  the ticket's own notes on why no `required_wiring` anchor was used).
  Considered moving it to `bubbleMirrorTopic.ts` alongside
  `bubbleMirrorTopicForPath` for symmetry, but `effectiveLetsTalkMirrorTopicId`
  itself already lives in `bridgeServer.ts` (pre-existing, untouched
  location) — moving only the new wrapper would split it from the function
  it calls for no benefit. Left as-is.

## Verification run

| check | result |
|---|---|
| `tsc -p .` (compile) | clean |
| `specs/pipeline/cli.js BL-709-bubble-its-own-telegram-topic.feature` | 8/8 |
| `specs/pipeline/cli.js BL-744…feature` (CRAP gate) | 3/3 |
| `vitest run test/letsTalkBridge.test.js` | 44/44 |
| `vitest run --config vitest.properties.config.mjs test/bl709BubbleOwnTelegramTopic.property.test.js` | 3/3 |
| `vitest run` (full suite) | 15 files / 25 tests fail, all pre-existing and unrelated (same set the coder documented at the parent commit — none touch `bridgeServer.ts`, `bubbleMirrorTopic.ts`, or any Let's Talk/Bubble mirror path) |

No defects found. Forwarding to architect with no cleaner-authored code
changes on top of the coder's commit.

By cleaner.
