# GH-23 Architect Bounce Evidence — unguarded CLI shell-out can crash the bridge server

**Stage:** architect · **Date:** 2026-07-23 · **Reviewed parcel commit:** `359c2f913d`
(from cleaner, task `GH-23`)

## Verdict: SEND BACK to coder

Architecturally the parcel is clean — dependency gate and co-change report both pass
(`node extension/out/tools/dependency-gate.js` / `co-change-report.js` on the four touched
bridge files), the two-layer boundary holds (host owns the `bb` shell-out, the Mini App
shell is pure fetch/render, no webview storage, no secret writes), and the surface pin
(live holistic Mini App, token-gated state route, pre-auth shell) is followed correctly.
But a concrete robustness defect is visible in the diff, and per
`swarmforge/roles/architect.prompt` ("A correctness defect you can SEE is a send-back
too — not a `rule_proposal`"), that is bounced, not merely proposed as a rule.

## The defect

`extension/src/bridge/contextTelemetryGate.ts:32-38` (`runCli`) calls
`execFileSync('bb', [CLI, ...args], {...})` with **no try/catch**. Both its callers,
`listTelemetryAgents` and `summarizeTelemetryForAgent`, propagate that unguarded call
straight through. `buildContextBudgetState` (`bridgeServer.ts:663-670`) calls both of
them directly, and the JSON-route dispatcher that invokes it
(`bridgeServer.ts:830-834`, `res.end(JSON.stringify(jsonRoute.compute(url)))`) has no
surrounding try/catch either — confirmed by grepping every `try {`/`} catch` pair in
`bridgeServer.ts`; none wraps the JSON-route dispatch.

If the `bb` (Babashka) binary is missing from PATH, or
`context_telemetry_cli.bb summary`/`agents` exits non-zero for any reason (corrupt
`.swarmforge/telemetry/context-events.jsonl`, a target repo with no Babashka installed,
etc.), `execFileSync` throws synchronously inside the `http.createServer` request
callback. There is no `process.on('uncaughtException', ...)` anywhere in `extension/src`
(grepped repo-wide) to catch it, so the exception propagates as an uncaught exception in
the extension host process — crashing the **entire bridge server**, not just the Context
Budget dashboard. Every other Mini App surface (`/console`, `/pipeline-grid`,
`/resident-spy`, `/paused-pager`) and the holistic UI riding the same `startBridge`
process go down with it.

## Precedent this deviates from

Every comparable shell-out/disk-read in this same file and its sibling host modules
already guards against exactly this failure mode and degrades to a safe fallback instead
of throwing:

- `bridgeServer.ts:634-638` (`computePausedPagerState`) wraps `fs.readFileSync` in
  try/catch, falling back to `yamlText = undefined` on failure.
- `extension/src/metrics/swarmMetrics.ts:117-126` (`gitFollowHistory`) wraps
  `execFileSync('git', ...)` in try/catch, returning `[]` on failure.
- `extension/src/bridge/residentPaneLive.ts` (`tryCaptureRolePane`) uses a
  non-throwing capture (`capturePane` + exit-code check) rather than a throwing
  `execFileSync`, for the same reason.

`contextTelemetryGate.ts`'s `runCli` is the one CLI shell-out in this surface area that
does not follow that convention.

## Remediation

Wrap `runCli`'s `execFileSync` call in `contextTelemetryGate.ts` in try/catch and degrade
to a safe empty shape on failure — mirroring the pattern above — e.g. `listTelemetryAgents`
returns `[]` and `summarizeTelemetryForAgent` returns the same all-null/`event_count: 0`
shape the CLI itself already returns for a zero-event agent (see
`context_telemetry_lib.bb`'s `summarize` on an empty `events` coll). That way a missing
Babashka install or a corrupt telemetry file degrades this one dashboard to its own
existing empty state instead of taking down the whole bridge server for every connected
Mini App / holistic UI client.

## Confirming commands

```sh
$ node extension/out/tools/dependency-gate.js src/bridge/bridgeServer.ts src/bridge/consoleMenuUiHtml.ts src/bridge/contextBudgetUiHtml.ts src/bridge/contextTelemetryGate.ts
Dependency-rule gate PASSED: no forbidden edges.

$ grep -n "try {\|} catch" extension/src/bridge/bridgeServer.ts
# (none of the matches wrap the JSON-route dispatch at line ~830, nor buildContextBudgetState)

$ grep -n "execFileSync" extension/src/bridge/contextTelemetryGate.ts
33:  const out = execFileSync('bb', [CLI, ...args], { ... });   # no try/catch
```
