# BL-696 amendment — Telegram Cursor Remote operator commands

**Date:** 2026-07-28  
**Status:** implemented (Cursor `/pilot` landed; acceptance green)  
**Parent:** BL-696 (Let's Talk + Cursor bridge parcel)

## Scope

Operator skills on the **Cursor Remote** Telegram forum topic (principal-only, topic-bound):

| Command | Behavior |
|---------|----------|
| `/pilot [BL-xxx]` | Cursor agent staffs an offline expedition (wears pipeline hats; no `claude -p`) |
| `/expedite [BL-xxx]` | Spawn detached `expedite_with_progress.sh` (default `BL-696`) |
| `/reexpedite [BL-xxx]` | Checkpoint main WIP, then relaunch expedite |
| `/redeploy` | Compile extension + restart supervised `telegram-cursor-bridge` |
| `/log [expedite\|redeploy\|bridge]` | Tail last lines of operator log (`/log` auto-picks running expedite) |
| `/update` | Operational snapshot: in-flight agent run, expedite progress, active backlog |
| Photo + optional caption | Downloaded and forwarded to Cursor agent as multimodal prompt |

Also:

- **`/pilot` vs `/expedite`:** `/pilot` asks the **Cursor bridge agent** to wear pipeline hats offline (Cursor-as-expeditor). `/expedite` spawns the automated `claude -p` driver. They refuse to overlap: `/pilot` is blocked while an automated expedite lock is held.
- Agent prompts run **non-blocking** so Telegram poll continues during long runs.
- Throttled progress posts (`🔧`, `✓`, `💭`) omit `reply_to` (no repeated quote of the original prompt).
- Short thinking fragments are **not** posted as progress noise.
- Assistant stream chunks are **not** posted as progress (final reply only).
- `/status`, `/log`, `/update` work while busy; new prompts and `/expedite` are gated.

## Acceptance

`specs/features/BL-696-telegram-cursor-bridge-operator-commands.feature`  
Steps: `specs/pipeline/steps/bl696TelegramCursorBridgeOperatorSteps.js`

## Implementation map

| Concern | Module |
|---------|--------|
| Decision parse | `telegramCursorBridgeCore.ts` |
| Live handlers / non-blocking prompt | `telegramCursorBridgeLive.ts` |
| Run tracker | `cursorBridgeRunTracker.ts` |
| Progress summarize | `cursorBridgeProgress.ts` |
| Expedite / reexpedite | `telegramCursorBridgeExpedite.ts` |
| Pilot (Cursor-staffed) | `telegramCursorBridgePilot.ts` |
| Redeploy | `telegramCursorBridgeRedeploy.ts` |
| Log tail | `telegramCursorBridgeLogs.ts` |
| `/update` snapshot | `telegramCursorBridgeUpdate.ts` |
| Shell wrappers | `swarmforge/scripts/expedite_with_progress.sh`, `redeploy_cursor_bridge.sh`, … |

## Non-goals

- Exposing these commands on Concierge or non-Cursor topics.
- Replacing `expedite_progress_notify.bb` (stage updates still push independently).
