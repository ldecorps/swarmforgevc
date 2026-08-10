# BL-789 — coder fix for the architect follow-up bounce (D1)

Fixes the gap recorded in
`BL-789-mac-host-switch-freshness-bridge-adopt-fixtureReaper-bounce-followup-20260810.md`:
scenario 05's real `front_desk_supervisor.bb` tick spawns a fourth detached
bridge process (`ctx.postTickStatus.bridge.pid`) that was registered with
fixtureReaper nowhere.

## Fix

`specs/pipeline/steps/bl789MacHostSwitchFreshnessBridgeAdoptSteps.js`:
imported `track` alongside the already-imported `onAbnormalExit` from
`./lib/fixtureReaper`, and called `track(ctx.bridgeRoot)` at the same point
`ctx.bridgeRoot` is established for the "an unrelated process is listening on
the bridge port" step (scenario 05's Given) — exactly the remediation the
bounce evidence specified. `reap()` already reads
`front-desk-supervisor.status.json` under that root and kills
`status.bridge.pid`, so the supervisor's own freshly-spawned bridge is now
covered with no bespoke callback.

## Verification

- `npm run test:properties -- bl789` (from `extension/`): 3/3 pass. The 3
  declared invariants are unaffected (fixture-cleanup-only change, no
  production code touched).
- `specs/pipeline/scripts/run_acceptance.sh specs/features/BL-789-mac-host-switch-freshness-bridge-adopt.feature`:
  7/7 scenarios pass, including scenario 05 ("A non-bridge listener on our
  port is cleared before spawning").
- Post-run `ps aux` for `start-bridge-headless`/`bl789`: only this host's own
  live production bridge (`.../swarmforgevc/extension/...`, port 8765) and
  production supervisor were present — no leaked test-fixture process.

By coder.
