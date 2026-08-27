# BL-698 leftover close-out — 2026-07-29

## Scope
Umbrella leftovers after BL-702/703/704: `/hold` `/reinstate` `/ambulance`
`/kill-all` `/drain-agents` `/drain-swarm`, `/stop` stop-mode menu, Control
slash aliasing of the shared execute backend.

## Landed
- `backlogWriter.parkToHold` / `reinstateFromHold`
- `telegramOperatorAmbulance` shared marker I/O (Control + Cursor Remote)
- `swarmStopper.drainAgentSessions` (role sessions only)
- `executeOperatorVerb` handlers for leftover verbs
- Cursor Remote `/stop` → Drain-stop / Emergency-stop buttons (`op:stop-drain` /
  `op:stop-emergency`); Live async pipeline wait for drain-swarm / drain-stop
- Control: slash `/ambulance`, `/hold`, `/reinstate`, `/drain-*`, `/kill-all`
  (kill-all → emergency stop)

## Tests (2026-07-29 focused)
- backlogWriter.test.js — 25/25
- telegramCursorOperatorExec.test.js — 14/14
- telegramControlCore.test.js — 56/56
- telegramCursorOperatorQueue.test.js — 14/14
- Combined: 109/109 pass

## Out of this pass
`/quiet` `/mode` `/lock` `/unlock` remain for a follow-up if needed.
