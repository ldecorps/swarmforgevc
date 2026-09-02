# BL-1311 — documenter pass — 2026-09-02

## Scope reviewed
Merged hardener commit `07020c93a4` (coder fix `0f3e69ed03`, cleaner NONE,
architect NONE, hardener mutation-kill pass, no code changes). Change: both
Let's Talk mirror call sites in `extension/src/bridge/bridgeServer.ts`
(`mirrorLetsTalkTurnToBubble`, `choicePollMirrorTarget`) now resolve via a
new `letsTalkMirrorTopicForPath` sibling that routes through the already-
exported `effectiveLetsTalkMirrorTopicId`, instead of the ordinary-Bubble
resolver `bubbleMirrorTopicForPath` / `effectiveBubbleMirrorTopicId`, which
returned `undefined` (by design) when no dedicated Bubble topic is bound —
silently dropping the turn instead of falling back to Cursor Remote.
Restored coverage: `extension/test/bl709BubbleOwnTelegramTopic.property.test.js`
(recreated) and two new cases in `extension/test/letsTalkBridge.test.js`.

## Checklist (Article 4.4 — complete inventory, one pass)

- **README / top-level docs**: no user-visible command, setting, or flow
  introduced or renamed. NONE.
- **`docs/reference/Specification.MD`**: this doc carries a "Last Updated"
  changelog convention (one entry per shipped ticket, chained via "Prior
  entry —"). The fix and its behavioural correction are user-relevant (the
  live Let's Talk fallback contract). Added a new top entry, dated
  2026-09-02, describing the defect and the fix. Committed in the same
  commit as the date bump, per the documenter role's "Last Updated" rule.
- **`docs/how-to/BL-718-bubble-talk-mirror-chunks-and-fails-loudly.md`**:
  checked against the fixed behaviour. This page already describes the
  correct contract ("When Bubble is unbound, the mirror falls back to
  Cursor Remote (BL-709 scenario 07)" via `effectiveLetsTalkMirrorTopicId`)
  — it was written aspirationally/correctly at BL-718's time and is
  accurate again now that the fix restores that behaviour. No content
  change needed. "Where it lives" still correctly points at
  `bridgeServer.ts` → `mirrorLetsTalkTurnToBubble`,
  `mirrorLetsTalkChoicePollToBubble` without naming internal helper names,
  so the new `letsTalkMirrorTopicForPath` helper needs no separate mention.
- **`docs/index.md`**: no new authored doc created (no new page to link);
  no page moved to `docs/deprecated/` (this is a bug fix restoring intended
  behaviour, not a retirement). NONE.
- **Diagrams (`docs/diagrams/`)**: checked `architecture.mmd` and
  `cursor-remote-flow.mmd` — neither depicts resolver-function-level detail
  (`bubbleMirrorTopicForPath` / `effectiveLetsTalkMirrorTopicId`); the
  Bubble/Cursor Remote mirroring topology itself is unchanged (still one
  mirror path, still Bubble-preferred with Cursor Remote fallback for
  Let's Talk). No diagram change-trigger fired. NONE.
- **Backlog evidence trail**: coder/cleaner/architect/hardener evidence
  files present under `backlog/evidence/BL-1311-*`. No gap.

## Findings
NONE. Clean sweep — no defects found in this pass.

## Handoff
Forwarding this commit (adds this evidence file) to QA under the same task
name.
