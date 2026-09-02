# BL-1311 — architect pass

Commit reviewed: e8d6798833 (merge of cleaner 0d5e3ba9d8, coder 0f3e69ed03 fix) · 2026-09-02 · worktree `architect`

## Review inventory — NONE found (forwarding)

- **Two-layer boundary / host-vs-view**: change is entirely inside the
  extension host (`bridgeServer.ts`, a resolver swap). No webview code
  touched, no browser storage, no direct process spawn, no secrets moved.
  Not applicable but checked.
- **Dependency-rule gate (BL-259, hard gate)**:
  `node out/tools/dependency-gate.js src/bridge/bridgeServer.ts` (run from
  `extension/`) → **PASSED: no forbidden edges.**
- **Co-change tool (BL-255)**:
  `node out/tools/co-change-report.js src/bridge/bridgeServer.ts` → many
  SUSPECTED COUPLING hits, all against `bridgeServer.ts`'s existing web of
  callers/tests (it's a 1823-mutation-site god-file per cleaner's note, so
  broad co-change is expected/pre-existing). Nothing in the report is new
  coupling introduced by this 4-line resolver swap + 3-line wrapper; no
  action.
- **Invariants review (BL-633/654)** — ticket declares two:
  1. "A completed Let's Talk turn reaches exactly one topic or fails loudly
     — never silently dropped." Encoded non-vacuously: property P3
     (`bl709BubbleOwnTelegramTopic.property.test.js`) plus the call-site
     regression test in `letsTalkBridge.test.js` ("unbound Bubble posts
     You/Bubble text to Cursor Remote, not silently dropped"). Coder's
     evidence recorded a break-then-fix run (reverted resolver → new
     regression test failed 0≠1 → restored → green); re-ran both suites here,
     still green. Swept the parcel for other sites of the same property:
     `choicePollMirrorTarget` (the only other call site) was switched in the
     same diff — no site left on the old resolver.
  2. "Ordinary Bubble mirroring keeps its never-fall-back contract — this fix
     must not make `effectiveBubbleMirrorTopicId` start returning Cursor
     Remote." Confirmed: `effectiveBubbleMirrorTopicId`'s body is untouched
     (diff only removes an import and adds two lines to the *caller* side);
     property P1 asserts it returns the bubble id when bound, P3 asserts
     `undefined` when unbound, never the cursor topic id in either case.
  No violation of either invariant found.
- **Correctness read**: fix matches the ticket's stated defect and direction
  exactly — both `bridgeServer.ts` call sites (`mirrorLetsTalkTurnToBubble`,
  `choicePollMirrorTarget`) now resolve via the new `letsTalkMirrorTopicForPath`
  → `effectiveLetsTalkMirrorTopicId`, instead of the ordinary-mirror resolver.
- **Property-testing support pass**: touched pure modules
  (`bridgeServer.ts` resolvers) already carry the declared-invariant property
  tests the coder authored (P1/P2/P3) — reviewed above. No further undeclared
  property gap on the touched surface; nothing else added.

## Verification re-run here

| check | result |
|---|---|
| `node out/tools/dependency-gate.js src/bridge/bridgeServer.ts` | PASSED, no forbidden edges |
| `node out/tools/co-change-report.js src/bridge/bridgeServer.ts` | informational only, no new coupling |
| `npx vitest run test/letsTalkBridge.test.js` | 44/44 |
| `npx vitest run --config vitest.properties.config.mjs test/bl709BubbleOwnTelegramTopic.property.test.js` | 3/3 |
| `node specs/pipeline/cli.js specs/features/BL-709-bubble-its-own-telegram-topic.feature` | 8/8 |
| `npx vitest run` (full suite, no path filter) | 15 files / 25 tests fail — identical set/count to coder's and cleaner's evidence, none touch `bridgeServer.ts`/`bubbleMirrorTopic.ts`/any Let's Talk/Bubble path; confirmed no new failure introduced by the merge into this worktree |

## Observation (not a bounce, not a rule_proposal)

After this fix, `bubbleMirrorTopicForPath` (`bubbleMirrorTopic.ts:71-72`) has
zero callers left anywhere in `extension/src` — both of its former call sites
in `bridgeServer.ts` were the buggy Let's Talk sites this ticket retargets, so
there was never a correct "ordinary Bubble mirroring" call site to begin with;
this parcel doesn't newly orphan a working mechanism, it removes the last
(incorrect) callers of a pre-existing wrapper. Not a required_wiring
situation (invariant 2 explicitly forbids touching
`effectiveBubbleMirrorTopicId`'s surface, and `bubbleMirrorTopicForPath`
predates this ticket, BL-744) and not in this ticket's scope to fix. Grepped
`backlog/` for `bubbleMirrorTopicForPath` — no dedicated ticket exists; not
raising one, since there is no live defect, only a dead 2-line wrapper someone
may want to delete or wire up whenever "ordinary Bubble mirroring" is
actually built.

## Verdict

Architecturally compliant. Forwarding to hardener.

By architect.
