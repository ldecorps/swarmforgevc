# BL-703 QA pass (cursor-as-expeditor /pilot) — 2026-07-29

## Scope check
Slice 2 of BL-698: hydrate/mint, autopilot/land batch pilot, swarm-live Stop &
run (drain then wait), land-sleep after queue, concurrent refuse via batch lock.
Parcel-holding tickets enrich land queue via readPipelineStages.

## Evidence
- Feature: specs/features/BL-703-operator-hydrate-autopilot-land.feature
- Modules: telegramCursorOperatorBatch.ts, OperatorQueue/Liveness, Live
  followOperatorExecuteResult + continueOperatorBatchAfterPrompt, Pilot
  composeHydratePrompt
- Unit tests (2026-07-29 focused):
  - telegramCursorOperatorQueue.test.js — 13/13 (batch, drain wait, liveness)
  - telegramCursorOperatorExec.test.js — includes autopilot/land dry
  - telegramCursorBridgeCore.test.js — busy gate for hydrate/autopilot/land
  - Combined focused run: 267/267 pass

## Scenario map
| Scenario | Coverage |
|----------|----------|
| /pilot refuses while swarm live | Live stopAndRunButtons + Pilot format |
| Stop & run drain then pilot | runOperatorStop + awaitSwarmDrain |
| /hydrate full-pack refuse | pre-confirm + execute refuse |
| /hydrate specifier-only | composeHydratePrompt + hydrate batch |
| /mint alias | executeHydrate mint mode |
| /autopilot dry selection | Queue + Exec dry |
| /autopilot sequential | Batch lock + advance after prompt |
| /land dry active-only | Queue selectLandQueue |
| /land then ask sleep | askLandSleep after batch complete |
| Concurrent refuse | isOperatorBatchInFlight + gateBusy |

## Invariants held
- /pilot /autopilot /land refuse while swarm live unless Stop & run clears first
- /hydrate /mint refuse when full-pack role up
- After /land clears queue, ask drain-stop each time
- /autopilot selects already-specced high/critical or defect
