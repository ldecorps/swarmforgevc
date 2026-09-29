# INTAKE — Claude knowledge-transfer turn on same-role swap into local-model

**Source:** human via Cursor, 2026-09-29 ~23:28–23:30 BST, verbatim
(Article 5.3 — keep both):

1. "could we imagine that the claude agent does a knowledge transfert?"
2. "yes please, and have it priorize as part of the local llm collection"

**Epic / track:** `local-llm-swarm` (BL-1125). Sibling of the agent-memory
transfer epic (BL-1176 — **done**: BL-1177 payload, BL-1178 hot-swap wiring,
BL-1179 cross-vendor matrix) and of the local-compact cards work
(BL-1798–1801).

**Priority:** **queue-jump** with the local-LLM collection (same standing
preference as the 2026-09-23 / 2026-09-29 local-model directives). Mint as
child(ren) of BL-1125; do not leave this as cold `debt/`.

## What is wrong

BL-1176 landed a portable payload and fail-closed hot-swap path. The
cross-vendor matrix already allows **Claude → `local-model`** (and refuses
Claude → `aider`). But today:

1. **Capture does not ask Claude to write** a real handoff — `continuitySummary`
   is mostly an empty/placeholder field filled from whatever
   `transcriptSummary` the caller passed (often blank).
2. **Inject validates** the payload but does **not** put that summary into the
   incoming local seat’s first turn / bootstrap, so even a good summary would
   not reach the local LLM’s context.
3. Mid-parcel Claude→local swaps therefore keep durable swarm state (mailbox
   parcels, worktree, role card) but **lose Claude’s working knowledge** —
   what’s in flight, what’s fragile, what already failed, what not to redo.

So a local seat on the same role does not benefit from Claude’s session the
way the epic’s intent suggested; the bag exists, the knowledge transfer does
not.

## What is wanted

Before a same-role model switch that lands on **`local-model`**, the
**outgoing Claude agent** runs one deliberate **knowledge-transfer turn** and
fills the existing portable payload for real; the **incoming local seat**
then starts with that brief in context.

Concrete intent (direction, not a locked design):

1. **Outgoing Claude turn (same role, still live):** prompted to produce a
   short brief — open parcels and status, decisions already taken, landmines,
   “do next / don’t redo”. Bound length so a small local window can absorb it
   (specifier pins the budget; align with BL-1798’s compact-card discipline).
2. **Fill BL-1177 fields:** that text becomes `continuitySummary` (and
   optionally structured bits in `handoffPack`) — still schema v1, never a
   vendor-opaque Claude session blob.
3. **Hot-swap path (BL-1178):** capture → inject (fail-closed, unchanged
   posture) → respawn as `local-model`. If the knowledge turn fails or the
   payload is empty when a transfer was owed, refuse the swap (do not pretend
   continuity).
4. **Incoming local seat:** prepend / inject the brief once into first-turn
   context (bootstrap note, launch seed, or equivalent — specifier picks the
   seam that `local-model` compose already uses). After that, normal role loop.
5. **Scope of pair:** required for Claude → `local-model`. Same-vendor Claude
   model bumps may keep today’s thin path. **Aider stays out** (BL-1179
   unsupported). Cross-role merge stays out of scope.

## Firm constraints

- **Do not break the live swarm** to experiment; fail-closed on the swap path.
- **Do not** ship Claude Memory / vendor blobs as the only artifact (BL-1177
  invariant stands).
- **Do not** claim continuity for `aider` seats.
- Prefer extending BL-1177/1178 seams over a parallel “second memory” system.
- Preserve human sentences from this intake verbatim in any minted ticket
  (Article 5.3).

## Evidence / pointers for the specifier

- [`docs/how-to/BL-1177-portable-agent-memory-payload-capture-inject.md`](../docs/how-to/BL-1177-portable-agent-memory-payload-capture-inject.md)
- [`docs/how-to/BL-1178-wire-agent-memory-into-hot-swap-and-trial.md`](../docs/how-to/BL-1178-wire-agent-memory-into-hot-swap-and-trial.md)
- [`docs/how-to/BL-1179-cross-vendor-memory-adapters-unsupported-matrix.md`](../docs/how-to/BL-1179-cross-vendor-memory-adapters-unsupported-matrix.md)
- `extension/src/tools/agentMemoryTransfer.ts`, `agentMemoryHotSwap.ts`,
  `agentMemoryVendorAdapters.ts` (`local-model` supported; `aider` not)
- Epic BL-1125; compact cards BL-1798–1801 (incoming context budget)

## Suggested split (1:N hint only)

1. Outgoing Claude knowledge-transfer turn → real `continuitySummary` on the
   Claude → local-model swap path; refuse empty when owed.
2. Incoming local-model first-turn injection of that summary (compose /
   launch seam).
3. Optional: acceptance + how-to; steward/trial path reuse if cheap.

## Disposition

Leave in `backlog/` for the specifier under BL-1125. **Queue-jump** with the
local-LLM collection per STEERING — mint promptly; human asked to prioritize
it as part of that collection.

## Specifier disposition (2026-09-29)

Split 1:N under epic BL-1125 (`local-llm-swarm`), queue-jump, both
approved at mint under the STEERING directive (no ruling choice posed):

- Suggested slice 1 (outgoing Claude knowledge-transfer turn, a real
  `continuitySummary`, refuse empty when owed) -> **BL-1815**.
- Suggested slice 2 (incoming local-model first-turn injection) ->
  **BL-1816**, a one-line pointer in the local-model composition while
  the brief is fresh, depends_on BL-1815.
- Suggested slice 3 (acceptance + how-to): folded into both. Each carries
  its own feature, and the documenter stage writes the how-to.

Premise corrected at mint. The BL-1178 hot-swap path cannot respawn a
seat as local-model: `backendSwitch.switchRoleModel` is the panel's
Claude-to-Claude dropdown, and `transferMemoryAcrossVendors` has no
caller. The live seam is the model steward's trial boundary
(`model_steward_cli.bb` `transfer-memory!`), which BL-1815 wires. Pack
cold-swaps to a local pack run no transfer at all. Whether they should
collect briefs too was put to the human on 2026-09-29.

Both human sentences above survive verbatim in BL-1815 and BL-1816.
