# How to read /pilot stage-boundary orphan cleanup (BL-701)

When `/pilot` finishes a stage or the run, the agent must check and kill
leftovers from **this** expedition before declaring the stage done or going
long-idle. Do not wait for the host orphan janitor (~2h).

## Cleanup targets

- Hung acceptance runners (`node --test`, `*.generated.test.js`, cucumber
  under disposable roots)
- Leftover Stryker / mutation jobs
- Related fixture babysitter / bridge processes under `/tmp/tmp.*` spawned
  for the run

## Never kill

- Host Cursor Remote bridge
- Operator
- Live-window / host-project processes protected by the orphan janitor

## Where it lives

- Prompt: `extension/src/tools/telegramCursorBridgePilot.ts` →
  `composePilotExpeditorPrompt`
- Tests: `extension/test/telegramCursorBridgePilot.test.js`
- Acceptance: `specs/features/BL-701-pilot-orphan-cleanup-stage-boundaries.feature`
