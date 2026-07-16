# BL-427: mutation-run worker RSS measurement report

Measure-first slice (BL-427). This report is the live-measurement artifact
`docs/Specification.MD`'s BL-427 section and the `mutation_cost`-adaptive
follow-up ticket are built on. It records what a real Stryker mutation run
actually costs in RSS per worker on the reference host, and what
`recommendMutationConcurrency` (`extension/src/metrics/mutationWorkerRss.ts`)
recommends from that measurement — not what the pure unit tests assert over
synthetic fixtures.

## Reference host

- 20 logical cores (`nproc`)
- ~15.5 GiB total RAM (`free -h`)
- Measured 2026-07-16, QA verification pass (post-fix re-run, see "Fix
  verified" below)

## How it was measured

```sh
node extension/out/tools/profile-mutation-workers.js \
  --interval-ms 2000 --reserve-mb 2048 \
  -- npx stryker run --mutate "out/metrics/mutationWorkerRss.js,out/tools/profile-mutation-workers.js"
```

This is a REAL `npx stryker run` invocation — the same way every other
mutation pass in this project is actually launched (`npm exec stryker run
...`), at the project's live, unmodified `extension/stryker.config.json`
`"concurrency": 4`. The harness samples every process in the spawned
command's full descendant tree (npx → npm exec → sh → stryker → its worker
processes) every 2 seconds until the run exits, and reports each sampled
process's peak (max) RSS.

## Result

```json
{
  "exitCode": 0,
  "maxPeakRssBytes": 821121024,
  "recommendedConcurrency": 9
}
```

- **Peak RSS across the real Stryker worker processes: ~783 MB** (821121024
  bytes) — the single highest peak among the 20 processes sampled in the
  full descendant tree for this run (most of the other sampled PIDs are the
  npx/npm/sh wrapper layers and short-lived helper processes, correctly
  distinguishable in the raw `perWorkerPeakRssBytes` map by their much
  smaller peaks).
- **Today's fixed concurrency: 4** (`extension/stryker.config.json`).
- **Reserve margin used: 2048 MB** (`DEFAULT_RESERVE_MB`), the harness's own
  default — a deliberate floor so the host is never sized to run to
  zero-free RAM.
- **Recommended concurrency at measurement time: 9** — computed by
  `recommendMutationConcurrency` from the REAL `os.freemem()` reading at the
  moment this run's report was built (a snapshot, not a fixed constant —
  free RAM on a shared dev/swarm box fluctuates with whatever else is
  running concurrently) against the measured ~783 MB peak and the 2048 MB
  reserve.

So on this reference host, at the RAM headroom available during this
measurement, the box could safely have run roughly **2x today's fixed
concurrency of 4** — using less of a shared, often RAM-constrained box's
free memory than the fixed setting risks on a leaner host, while still
running faster on a host with more headroom than 4 workers currently
exploit. This is the evidence the named adaptive-concurrency follow-up
ticket's default is built on; it is a snapshot, not a permanent number —
the whole point of that follow-up is to compute this recommendation live at
launch time rather than freeze today's reading into a new fixed constant.

## Fix verified

The harness's own QA gate caught a real defect in this exact measurement
path before this report could be trusted: `sampleWorkerChildrenOnce`
originally sampled only the DIRECT children of the spawned command, so
wrapping the command through `npx`/`npm exec` (this project's own actual
invocation convention) silently sampled the intermediate shell wrapper
(~1 MB) instead of the real workers, producing a report off by roughly
three orders of magnitude with no error raised
(`backlog/evidence/BL-427-profile-mutation-worker-rss-bounce-20260716.md`).
Fixed by walking the full descendant process tree
(`collectDescendantPids`, breadth-first over `listChildPids`) rather than
only the spawned process's immediate children. The measurement above is
from the RE-VERIFIED run, after that fix, using the project's real `npx
stryker run` invocation — the same command class the original defect
silently mismeasured.

## Scope note

This run mutated only BL-427's own two source files
(`mutationWorkerRss.ts`, `profile-mutation-workers.ts`) — a small,
fast-to-run scope chosen so the live measurement itself does not become
another multi-hour, RAM-heavy overnight run; it exercises the SAME 4
concurrent Stryker worker processes at the SAME per-worker memory profile
(one Vitest thread + Node heap each, per the worker-thread engineering
rule) a full-repo mutation pass would, since worker RSS is driven by the
test runner's own footprint, not by how many files are being mutated in a
given pass.
