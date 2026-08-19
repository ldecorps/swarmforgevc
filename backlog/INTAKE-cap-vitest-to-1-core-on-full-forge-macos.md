# Raw intake — cap vitest's worker pool to 1 fork while the live swarm runs on macOS full-forge

Status: new intake, not minted. Capture only (human, 2026-08-19 ~00:1x
local). Human ask (verbatim, paraphrased from chat): "should we allocate
only 1 core to vitest?" — confirmed: "ok for an intake to limit vtest to
1 core on full forge on mac".

## Observed (coordinator, live, 2026-08-19 ~00:11-00:15 local)

- Host: 4 physical cores (`sysctl -n hw.ncpu` = 4).
- `uptime` load average at the time: 16.62 / 14.91 / 19.85 (1/5/15-min) —
  4-5x the core count, sustained (15-min average is the highest of the
  three, not a momentary spike).
- Pack is `full-forge`: 8 concurrent Claude sessions (7 pipeline roles +
  coordinator) plus `handoffd`, the front-desk bridge/bot, and whatever
  ad-hoc tooling a role shells out to — all fixed cost, already
  oversubscribing the 4 cores before any test tooling runs.
- At the moment of observation, **two separate `vitest run` invocations
  were running concurrently** (worker sets started ~00:10 and ~00:12
  local), each spawning 3-4 forked worker processes — plausibly 6-8
  vitest processes alone, layered on top of the 8 agent sessions.
- `extension/vitest.config.mjs` already caps the default forked-process
  pool (`WORKER_POOL_SIZE`, via `resolveWorkerPoolSize`, BL-422) — but
  that budget is sized off **total system memory**
  (`os.totalmem()`), not CPU count or current host load. It exists to
  stop OOM-killer death-spirals (BL-422's own history: one run ballooned
  four workers to ~13GB), a different axis entirely from CPU contention
  under a live 8-session swarm. Do not conflate the two — this intake is
  about the CPU axis, which nothing currently governs.

## Why this might matter beyond "tests run slower"

- Matches the standing lesson (`lesson_stryker_dryrun_timeout_under_load.md`):
  mutation testing should be skipped/deferred whenever load is `>>2x
  cores` — at 4-5x, Stryker dry-runs are liable to time out outright, not
  just run slow, if the hardener reaches a mutation-heavy ticket while
  vitest is also mid-run.
- Plausible contributor to the QA processing-time increase measured this
  same evening (mono-router vs full-forge dwell comparison: QA avg
  processing went from ~848s to ~2124s after switching to full-forge) —
  QA's reconcile/merge work competes for the same starved cores as
  concurrent test runs.

## Goal (specifier decides exact shape)

While the live swarm is running under the `full-forge` pack on macOS,
vitest's worker pool should be constrained tighter than the existing
memory-based `WORKER_POOL_SIZE` allows — down to as little as 1 fork —
so a test run doesn't compound the CPU oversubscription already caused
by 8 concurrent agent sessions.

Open questions for the specifier to settle (not locked by the human):

- **Scope**: always 1 fork on macOS, or conditional on detecting a live
  swarm / high host load / the `full-forge` pack specifically? A static
  "1 fork on macOS" is the smallest change but would also throttle a
  human running the suite solo on a quiet laptop.
- **Mechanism**: an env var override (e.g. `SWARMFORGE_VITEST_MAX_FORKS`)
  read by `resolveWorkerPoolSize`/`vitest.config.mjs`, vs. a separate
  CPU-aware budget function layered alongside the existing memory-based
  one. Keep `WORKER_POOL_SIZE`'s existing OOM-prevention role intact —
  this is an additional constraint, not a replacement.
- **Where it's set from**: could be swarm-launch-time (a pack/conf flag
  the coder wires vitest to read), or detected dynamically (load average
  at run start). Dynamic is more general but adds complexity; a static
  pack-level flag may be enough for now.

## Out of scope

- Changing `WORKER_POOL_SIZE`'s existing memory-based sizing logic or
  its OOM-prevention purpose (BL-422). This intake adds a second,
  independent constraint — it does not touch that one.
- Stryker's own pool (`pool:'threads'` + `maxThreads:1`, already fixed
  per `engineering.prompt`'s worker-thread rule) — already covered,
  unrelated to this intake's `vitest run` (unit suite) scope.
- Host-capacity questions beyond vitest specifically (e.g. BL-101
  headless secondary swarm, staffing model/effort choices) — those are
  separate, already-tracked concerns; this intake is scoped to vitest's
  own worker-pool CPU footprint only.

## Source

Human ldecorps, chat with coordinator, 2026-08-19 ~00:1x local, after the
coordinator reported the host load average (16.6/14.9/19.9 on 4 cores)
in response to "is the old mac keeping up?".
