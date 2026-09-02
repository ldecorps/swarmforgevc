# INTAKE — Raise the vitest fork-pool ceiling under a mono-router (`rotation router`) pack

**Source:** human via Claude Code chat, 2026-09-02  
**Status:** new intake, not minted  
**Priority:** low/perf — no correctness or safety risk either way; a missed
opportunity to run the unit suite faster while a mono-router pack is live,
not an incident.

## Goal

When the live swarm is running a `rotation router` pack, let the vitest
fork pool size above its current default ceiling, because router topology
already guarantees no sibling pipeline role is running tests (or anything
else CPU-heavy) at the same time — the one CPU-contention signal the
ceiling logic exists to protect against does not apply.

## Current mechanism (for context, nothing here is broken)

`resolveVitestForkCeiling` (`extension/src/tools/vitest-worker-memory-budget.ts`)
is BL-935's CPU-axis ceiling, composed into `resolveVitestWorkerPool` and
called identically from both `extension/vitest.config.mjs` and
`extension/vitest.properties.config.mjs`:

```
if (pack === 'full-forge' && platform === 'darwin') return 1;
return defaultCeiling; // MAX_WORKERS = 6
```

It only lowers the ceiling for the exact `full-forge` pack name on macOS
(8 concurrent Claude sessions oversubscribing a 2-core host — BL-935's
`INTAKE-cap-vitest-to-1-core-on-full-forge-macos.md`). Any other pack,
including every mono-router pack (`anthropic-mono-router`,
`openrouter-anthropic-mono-router`, `bob-multi-provider-mono-router`, …),
already falls through to `defaultCeiling` (6) unmodified — it is **not**
currently throttled by this mechanism. `resolveWorkerPoolSize`
(BL-422/BL-792) then further bounds that ceiling by the host's actual RAM
— a memory-OOM guard, orthogonal to role-count contention, and correctly
untouched by anything below.

## Why router mode is a real, different case (not just "already fine")

Under `config rotation router`, `swarmforge.sh` only ever launches TWO
live sessions: `swarmforge-coordinator` and ONE resident pane that rotates
in place through every pipeline role (`rotate_to_role`). Every other role
gets `generate_dormant_role_launch_artifacts` — a pre-generated launch
script and settings JSON, with **no session and no process** — specifically
so the resident can respawn as that role later. That is a structurally
different topology from `full-forge`, where all 7 pipeline roles plus
coordinator are live simultaneously. Under router, a vitest run inside the
resident role is contending with at most the coordinator, not 7 sibling
role sessions — there may be room to raise the ceiling *above* the current
default 6, not just avoid lowering it, since the RAM floor stays as the
actual safety backstop regardless of what ceiling is passed in.

## Gap: rotation mode is not currently visible to the test runner

`SWARMFORGE_PACK` is exported into the role's env at swarm launch
(`swarmforge.sh:2006`, `export SWARMFORGE_PACK='$launch_pack_name'`) and
is what `resolveVitestForkCeiling` reads today. Rotation mode itself
(`sequential` vs `router`) is computed separately (`rotation_value` around
`swarmforge.sh:1119-1128`) and written to `.swarmforge/swarm-identity`,
but is never exported into the process env the way the pack name is — so
there is currently no signal `resolveVitestForkCeiling` could read to
detect router mode even if it wanted to.

## Open questions for the specifier

- **New ceiling value**: a fixed higher constant (e.g. a new
  `MAX_WORKERS_ROUTER`), or something host-derived (`os.cpus().length`)?
  Either way `resolveWorkerPoolSize`'s RAM budget still floors/caps the
  final count, so no OOM regression is possible from this alone.
- **Signal mechanism**: export a new env var (e.g. `SWARMFORGE_ROTATION`)
  alongside `SWARMFORGE_PACK` at `swarmforge.sh:2006`, read the same way
  `pack`/`platform` are read today — preferred over pattern-matching pack
  *names*, since router packs are not a fixed enum (new mono-router packs
  get minted regularly per the pack-from-profile intake).
- **Coordinator overlap**: the coordinator session is always live
  alongside the resident even under router — decide whether the new
  ceiling should account for coordinator doing real (non-test) work
  concurrently, or treat it as negligible the way it's already implicitly
  treated in the full-forge case.
- **Both lanes**: BL-935 deliberately unified the unit and property lanes
  behind one `resolveVitestWorkerPool` call so they cannot drift — this
  change should stay inside that same single composition point rather
  than adding a second one.

## Out of scope

- The RAM-derived floor / `MAX_WORKERS` baseline itself (BL-422/BL-792) —
  untouched, stays the real safety backstop.
- The existing `full-forge` + `darwin` → 1 special case — untouched.
- Stryker's own hardcoded `pool:'threads'` + `maxThreads:1` — already
  independent of this whole mechanism per BL-935's own scoping.

## Relations

- BL-935 — introduced the CPU-axis ceiling and the single composition
  point (`resolveVitestForkCeiling` → `resolveVitestWorkerPool`) this
  intake extends.
- BL-871 — property-lane invariant tests assert both lanes share one
  route; new tests added here must preserve that invariant, not just add
  a second copy of the router-ceiling logic to one lane.
- BL-422 / BL-792 — RAM floor, referenced but not modified.

## Source

Human ldecorps, Claude Code chat, 2026-09-02, after asking whether vitest
concurrency could be raised under a mono-router pack "since there won't be
another role running any tests in parallel." Investigation in that session
found the mechanism does not currently throttle mono-router at all (it was
never restricted to begin with) and confirmed the gap above — rotation
mode is computed but not exported to the process env vitest reads.
