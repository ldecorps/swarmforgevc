# BL-602 — coder rematch — architect bounce 20260827

## Bounce

Architect `f14be52703`: four declared invariants had no `*.property.test.js`.

## Rematch

Added `extension/test/handoffLatencyInvariants.property.test.js`:

| # | invariant | encoding |
|---|---|---|
| 1 | Still-queued → OPEN wait only | P1: no `dequeued_at` ⇒ `status: open`, no `latencyMs` |
| 2 | Gather covers master + worktree mailboxes | P2: fixture both layouts; new/in_process/completed all contribute |
| 3 | Aggregation pure over pairs | P3: deepEqual on clone; open never counted in processed buckets |
| 4 | Measuring never changes dispatch/rotation/claim | P4: source of `handoffLatency.ts` does not import those surfaces |

By coder.
