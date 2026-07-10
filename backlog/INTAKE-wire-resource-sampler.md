# INTAKE: wire the resource sampler into extension activation (gap #7)

Source: operator direction 2026-07-10 (via coordinator, spec-vs-implementation
gap pass): gap #7 — the resource-usage sampler is BUILT but never started, so it
reports "no samples" on every live swarm. Operator approved closing it.

## The gap (coordinator verified)
`extension/src/metrics/resourceTelemetry.ts` is complete and tested — it exports
`startResourceSampler(...)`, `stopResourceSampler(...)`, `sampleProcessStats(pid)`,
and `appendResourceSample(targetPath, role, rss, cpu, atMs)`. The READ side already
consumes its output (`metrics/swarmMetrics.ts`, `tools/swarm-metrics.ts`,
`notify/costHealthSidecar.ts`, `bridge/bridgeState.ts`). BUT `extension.ts` never
references it (grep-confirmed) — the sampler is never STARTED, so no samples are
ever appended and every downstream reader shows "no samples yet."

## Want (observable)
- While a swarm is running, RSS/CPU samples are actually collected per role and
  appended (via the existing `appendResourceSample`), so the cost/resource
  readers (`/cost-telemetry`, cost sidecar, bridge) show real data instead of
  "no samples."
- The sampler starts when the swarm starts and stops when the swarm stops (no
  leaked interval after teardown).

## Fit / reuse (this is a WIRING ticket — do NOT rebuild the module)
- Reuse `startResourceSampler` / `stopResourceSampler` / `sampleProcessStats` /
  `appendResourceSample` as-is. The work is: call them from the extension's real
  swarm-lifecycle/activation path, resolving each agent's pid from the existing
  tmux/swarm-discovery layer (`swarm/tmuxClient.ts` / `swarm/swarmDiscovery.ts`),
  sampling on a tick, appending per role.
- Verify the live activation + swarm start/stop path before naming files.

## Constraints
- NO REAL TIMERS in tests (engineering rule): `startResourceSampler` already takes
  an injectable tick/interval — assert start→sample→append and stop→no-more-append
  against fakes/injected clock, never wall-clock. The lifecycle wiring decision
  (start on swarm-up, stop on swarm-down) is a pure/testable unit.
- No leaked sampler: stopping the swarm must stop the sampler (assert it).
- Do NOT change the telemetry FORMAT or the reader side — only start producing the
  samples the readers already expect.

## Delivery
Small, buildable now (module already exists + tested; this closes the last-mile
wiring). Priority: suggest normal-high (cheap, unblocks the whole cost/resource
surface). Likely one slice.
