# BL-1166 — coder rematch — architect APS bounce 20260827

## Bounce

Architect: APS 4/7 failed — `startBridge` without `CURSOR_API_KEY`.

## Rematch

`withBridge` in `bl1166OperatorDocsSteps.js` stubs disposable
`CURSOR_API_KEY=test-key` for the bridge lifetime (BL-915 posture) and restores
afterward.

By coder.
