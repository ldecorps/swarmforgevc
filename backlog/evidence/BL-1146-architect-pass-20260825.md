# BL-1146 — architect pass — 20260825

**Tip:** cleaner `8f3a3fc147` (coder `32f621d9e7`)
**Handoff:** `00_20260825T205621Z_000864_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner tip stacks BL-1144/1145 lineage; **0 deletes** vs `origin/main`.
Authorize **BL-1146 paths only** (bridge core/live enqueue-next pin + hold).

## Architecture

- Root cause: busy queue votes dropped; no pre-pin for idle auto-start; no
  hold when host finishes with a question.
- Fix: `enqueueNextPromptId` on persisted state; `decideIdleQueueTransition`
  + `hostReplyTextIsQuestion` in core (pure); Live wires busy enqueue-next
  poll mode and `applyIdleQueueTransition`. BL-810 choose-next unchanged
  when no pin.
- Fail-closed toward hold (question detection + `needsHumanFromAwaitingAnswer`).

## Verification

| Check | Result |
|-------|--------|
| `node --test bl1146HostQueueEnqueueNext.property.test.js` | 6/6 pass |
| APS BL-1146 feature | 6/6 pass |
| Tip deletes | 0 |

By architect.
