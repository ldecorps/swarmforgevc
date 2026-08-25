# BL-1146 hardener pass — host queue enqueue-next hold — 20260825

**Architect tip:** `b19a189c4b` (coder `32f621d9e7` / cleaner `8f3a3fc147`)
**Task:** `BL-1146-host-queue-enqueue-next-hold-on-host-question`

## Tip purity

Merged architect handoff (resolved BL-1144/1145 manifest conflicts).
Authorize **BL-1146** paths only. **0 deletes.**

## Product surface

`telegramCursorBridgeCore`: `enqueueNextPromptId`, `decideIdleQueueTransition`,
`hostReplyTextIsQuestion`, `clearEnqueueNextIfStale`. Live wires busy
enqueue-next + `applyIdleQueueTransition`.

## Gates

| Gate | Result |
|------|--------|
| `bl1146HostQueueEnqueueNext.property.test.js` | 7/7 (node --test) |
| APS BL-1146 feature | 6/6 |
| Soft Gherkin | `outcome: inapplicable` — not a pass (BL-638) |
| Surgical (7) | killed=7 survived=0 skipped=0 |
| BL-149 | Core + Live `skip-cooldown` |

## Soft → surgical (BL-638)

Core: hold-pin, auto-start id, stale-pin clear, no-pin poll, question
detect, clearEnqueueNextIfStale, ack copy. Added property test for stale
pin → `clear-stale-pin-then-poll` (killed survivor).

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1146.

By hardender.
