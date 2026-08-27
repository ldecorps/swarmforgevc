# `/pilot safe` — auto-pick a low-blast defect for offline pilot (BL-722)

Picking among ~15 low-blast defects by hand was slow and error-prone. `/pilot
safe` encodes the human-approved safe scope so the operator does not have to
hand-pick.

## What it does

- **`/pilot safe`** — filters `backlog/paused/` to the safe pool, ranks it,
  and starts `/pilot` on the top match (same offline pilot hat-walk as
  `/pilot BL-xxx`).
- **`/pilot safe --list`** (or `/pilot safe list`) — lists the current safe
  pool without starting anything.

## The safe filter

A ticket qualifies only if **all** of these hold:

- `type: defect`
- `human_approval: approved`
- `mutation_cost: low`
- `status` is not `needs_design`
- its `acceptance:` field (or a same-id file under `specs/features/`) names a
  real, non-draft `.feature` file

Any other field combination — including a high/medium-mutation defect, or a
feature ticket — is excluded. There is no fallback: the filter never widens
itself to fill an empty pool.

## Ranking

Matches sort **severity (critical → high → medium → low → unset) → priority
→ ticket id**, and `/pilot safe` starts the first one. `/pilot safe --list`
shows the same order.

## Empty pool

If nothing matches, `/pilot safe` replies `Safe pilot pool empty.` with the
reason and starts nothing — it never falls back to a medium/high-mutation or
`needs_design` ticket. `/pilot BL-xxx` remains the explicit escape hatch for
any ticket id, safe-filtered or not.

## Where it lives

- Pure filter + rank: `extension/src/tools/pilotSafeDefects.ts`
  (`listSafePilotDefects`, `pickSafePilotDefect`)
- Command parsing: `extension/src/tools/telegramCursorBridgePilot.ts` →
  `parsePilotSafeCommand`
- Dispatch: `extension/src/tools/telegramCursorBridgeCore.ts` →
  `decideOperatorCommand` / `pilotSafeDecision`
- Handlers: `extension/src/tools/telegramCursorBridgeLive.ts` →
  `pilot-safe-list` / `pilot-safe-start`
- Tests: `extension/test/pilotSafeDefects.test.js`,
  `extension/test/pilotSafeDefects.property.test.js`
- Acceptance: `specs/features/BL-722-pilot-safe-defects.feature`

See [BL-698 operator commands](BL-698-telegram-cursor-operator-commands.md)
for where this sits among the other `/pilot` verbs, and
[BL-727's landing gate](BL-727-pilot-acceptance-contract-gate.md) for how a
pilot run (safe-picked or explicit) actually lands.
