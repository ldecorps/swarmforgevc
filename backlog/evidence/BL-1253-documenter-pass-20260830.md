# BL-1253 — documenter pass (2026-08-30)

## Scope
Stamp-off of Cursor hotfix `2ec06b6ef1` ("Own getUpdates when the front-desk
inbound feeder is dead"). Review-only ticket: no production code touched by
this pass, no ledger write (human decision only, per BL-848).

## What was checked
- `git log` / `git show` on the merged commit chain (coder → cleaner →
  architect → hardener) confirmed no defect was found at any stage and no
  hotfix source line was reimplemented or reverted.
- Confirmed the landed behaviour at `2ec06b6ef1` was not previously reflected
  in `docs/reference/Specification.MD` or in the how-to that documents the
  mechanism it changes (`docs/how-to/BL-764-front-desk-shared-token-bridge-fanout.md`)
  — the hotfix landed outside the normal pipeline (BL-848), so no documenter
  pass had run against it before this stamp-off.

## What changed
- `docs/reference/Specification.MD`: new dated entry describing the landed
  hotfix behaviour (feeder-liveness gated queue mode, re-checked every poll,
  `start_cursor_bridge.sh` default) and noting this stamp-off confirms rather
  than reimplements it; hotfix ledger row stays `stamp-open` pending human
  decision.
- `docs/how-to/BL-764-front-desk-shared-token-bridge-fanout.md`: updated step
  2 and the "Configuring it" / "Where it lives" sections — queue mode is no
  longer described as assumed for the process lifetime; it now documents the
  per-poll feeder-liveness re-check and the launch-time
  `CURSOR_BRIDGE_INBOUND_QUEUE` default when the feeder is dead at start.

## Diagrams
Checked `docs/diagrams/architecture.mmd` for any Cursor-bridge /
front-desk-heartbeat depiction — none exists at the diagram's level of
detail, so no diagram change-trigger fired (Diagrams article).

## Not done (out of scope for this pass)
- Hotfix ledger row (`backlog/hotfix-ledger.yaml`) — human decision only.
- Any change to `extension/src/tools/cursorBridgeInboundQueue.ts` or
  `start_cursor_bridge.sh` — landed hotfix content, out of scope per the
  ticket's constraints.

By documenter.
