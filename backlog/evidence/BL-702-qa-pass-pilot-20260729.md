# BL-702 QA pass (cursor-as-expeditor /pilot) — 2026-07-29

## Scope check
Slice 1 of BL-698: shared Cursor Remote danger tiers + confirm gate, env-reload
on relaunch, lifecycle verb execute twins for stop/pause/resume/start. Hydrate /
autopilot / land / shifts remain BL-703 / BL-704 (already stubbed in tree but
out of this ticket's acceptance).

## Evidence
- Feature: specs/features/BL-702-operator-parse-env-reload-danger-tiers.feature
- How-to: docs/how-to/BL-702-operator-confirm-env-reload.md
- Modules: telegramCursorOperatorCore.ts, telegramCursorOperatorExec.ts,
  Live pending-confirm + gate wiring, buildLaunchEnv swarm.env merge
- Unit tests (2026-07-29):
  - telegramCursorOperatorCore.test.js — 7/7
  - telegramCursorOperatorExec.test.js — 8/8
  - telegramCursorBridgeCore.test.js — 88/88 (includes op:confirm / cancel)
  - swarmLauncher.test.js — 52/52 (includes BL-702 env merge)
  - telegramCursorBridgeLive.test.js — 96/96 (includes pending confirm round-trip)
  - Combined focused run: 251/251 pass

## Scenario map
| Scenario | Coverage |
|----------|----------|
| Unauthorised hard verb refused | BridgeCore refuse (no execute) |
| Hard verb outside Cursor Remote ignored | BridgeCore ignore wrong topic |
| Hard confirm → ensure | BridgeCore op:confirm → execute-operator; Exec single-flight lock |
| Soft confirm → compile | BridgeCore soft prompt + op:confirm → execute |
| /confirm-off clears pending | BridgeCore clear-operator-pending; Live pending file clear |
| /restart + swarm.env | Exec bounce sentinel; buildLaunchEnv merge test |
| buildLaunchEnv merges swarm.env | swarmLauncher.test.js |
| /bounce bridge like redeploy | Exec routes to startRedeployRun |
| /syncenv no secrets | Exec formatSyncenvReport (soft confirm per Q1) |
| /pause /resume control-pause | Exec writeOperatorPauseState |
| /stop kill_all_swarm | Exec runOperatorStop with fixture script |
| /start bounce sentinel | Exec runOperatorStart |

## Invariants held
- Hard verbs never mutate without principal + Cursor Remote + confirm
- Soft verbs need one Confirm tap
- buildLaunchEnv / bounce / restart / start / redeploy child env merges swarm.env
