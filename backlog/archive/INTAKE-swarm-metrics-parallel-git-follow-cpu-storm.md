> **DISPOSITIONED 2026-08-22 — minted as [BL-1066](../paused/BL-1066-metrics-poll-tick-restarts-a-102-second-git-walk.yaml)** (1:1, no split). All three locked human decisions carried through verbatim into that
> ticket's `notes:` (defect / high / queue-jump + `human_approval: pending` / front of queue).
> One correction was made during scoping: the per-call fan-out is SEQUENTIAL (`execFileSync`), not parallel — the concurrency comes from a ~102s computation being scheduled on a 2s poll tick.

# Raw intake — Mean-ticket-time walks every done backlog file with `git log --follow`, and parallel runs melt the host CPU

Status: **URGENT** — new intake, not minted. Capture only (human via Let's
Talk / Cursor, 2026-08-22 ~14:47 CEST, WSL host).

Human ask (paraphrased, same session): the swarm's CPU is high; the hot
processes are many parallel `git` invocations; analyse them and file an
intake so the specifier can treat this as a **defect**, at **high**
severity, and as a **Q jump** (queue-jump / Article 3.2.4 expedite lane)
so it is not ordinary polish.

## Observed (live, WSL, 2026-08-22 ~14:46–14:47 local)

- Host: 20 logical CPUs; load average ~15.8 / 12.3 / 10.7.
- Top snapshot: ~60% user + ~8% system, ~26% idle — sustained busy, not a
  one-second spike.
- Concurrent hot processes (each pegging ~90–100% of a core), all of the
  same shape:

      git -C <repo-root> log --follow --name-status \
        --format=COMMIT%x09%cI -- backlog/done/.../<BL-*.yaml>

  Distinct done-ticket paths in flight at once (examples captured live):
  BL-478, BL-690 (twice), BL-705, BL-717, BL-926, and more arriving as
  others finished. Several `[git] <defunct>` zombies were also present.
- Same window: multiple Vitest worker processes also at high CPU. The git
  storm was layered on top of an already-busy test lane.

## Root cause (probe, not yet a minted ticket)

`extension/src/metrics/swarmMetrics.ts` — `computeMeanTicketTime` lists
every closed ticket under `backlog/done/` (`listDoneBacklogPaths`), then
for **each** path shells `gitFollowHistory`, which is exactly:

    git log --follow --name-status --format=COMMIT%x09%cI -- <relativePath>

Measured size of the subject today: **~790** done `BL-*.yaml` files. One
mean-ticket-time pass is therefore on the order of hundreds of follow
walks. `--follow` is rename-aware and expensive; running many of these in
parallel (Vitest forks, overlapping metrics callers, or a live-repo test
that still points at the real tree) saturates the host.

Related but **not** the same ticket (specifier: cite, do not merge blindly):

- **BL-1038** (active, defect/high, unit-suite-speed) — unit tests that
  take the *live* repo as subject so suite cost grows with history. That
  ticket lists seven files; it does not name this per-done-file `--follow`
  loop as its own algorithmic defect. Even after BL-1038 pins fixtures,
  an unbounded N×`--follow` over hundreds of paths remains a host hazard
  whenever the function runs against a large tree (fixture or live).
- Archived `INTAKE-cap-vitest-to-1-core-on-full-forge-macos.md` — caps
  Vitest forks under live swarm load (CPU axis). Complementary throttle;
  does not fix the git work per ticket.

## Why this is a defect (not a nice-to-have optimisation)

- Live host health: sustained multi-core saturation and load well above
  core count while the swarm / unit lane is running.
- Predictable growth: every closed ticket adds another `--follow` walk;
  cost rises with backlog success, not with intentional test coverage.
- Contends with the live swarm (roles, handoffd, bridges) the same way
  the standing load lessons warn about (Stryker / full-forge CPU
  oversubscription).
- Zombie `git` processes suggest callers are not always reaping cleanly
  under the storm — a reliability smell on top of the CPU cost.

## Goal (specifier decides exact shape)

Stop mean-ticket-time (and any sibling caller of the same pattern) from
being able to open an unbounded fan-out of `git log --follow` over the
whole done corpus in a way that melts the host.

Open questions for the specifier (defaults welcome):

1. **Algorithm** — replace per-file `--follow` with one (or few) bulk
   history reads, a cache keyed by path/commit, sampling, or a cheaper
   arrival signal that does not rename-follow every done file.
2. **Concurrency** — hard cap on concurrent `git` children from this
   path (and reap them); never N≈done-count in parallel.
3. **Call sites** — audit who invokes `computeMeanTicketTime` /
   `computeSwarmMetrics` against a large or live tree during the unit
   lane vs operator/CLI paths; align with BL-1038's pinned-fixture rule
   where the caller is a unit test.
4. **Acceptance** — a regression that fails if a single mean-ticket-time
   (or metrics) computation against a fixture with many done paths
   spawns more than a bounded number of `git` processes, or exceeds a
   fixed wall-clock budget independent of live-repo growth.

## Out of scope unless amended

- General Vitest worker-pool sizing (separate intake / BL-422 memory
  axis) — cite only.
- Reworking every live-repo unit test listed in BL-1038 — that ticket
  already owns that slice; this intake owns the `--follow`-per-done-file
  storm itself.
- Killing ad-hoc human `git log` use.

## Locked human decisions (carry through)

1. **Mint as `type: defect`, `severity: high`.** Human explicitly asked
   that this be treated as a defect, not a feature or cleanup.
2. **Q-jump / expedite posture.** Specifier: use Article 3.2.4 expedite
   eligibility (`defect` + `severity: high`), `direction: queue-jump` (or
   the house equivalent that marks Approvals Q-jump), and
   `human_approval: pending` so the human can `/qjump` / tap Expedite on
   the Approvals ask same-shift. Do not bury this behind ordinary
   priority ranking as polish.
3. **Priority near the front of the queue** after mint — host CPU while
   the swarm runs is a live fault, not backlog hygiene.

## Specifier notes

Probe was live on WSL under Cursor + Vitest; re-verify the call stack
(which parent spawns the parallel `gitFollowHistory` wave) before locking
invariants. Prefer one clean slice that removes the unbounded fan-out;
split only if algorithm change and call-site pinning cannot land together
without an oversized parcel.
