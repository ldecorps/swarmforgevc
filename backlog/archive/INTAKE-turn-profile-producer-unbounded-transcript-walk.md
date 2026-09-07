# INTAKE — turn-profile-producer-sweep re-walks every transcript ever, every tick, unbounded

**Source:** human via Claude Code, 2026-09-07  
**Status:** new intake, not minted  
**Priority:** high — same defect shape as BL-1454 (critical, swarm-crashing),
caught before it got that bad, but on the same trajectory: cost grows every
day the swarm runs, with no cap.

## What's wrong

`handoffd.bb`'s `turn-profile-producer-sweep!` shells to
`run-turn-profile-producer.js` on every daemon cycle (own comment: "firing
every cycle is safe" — true for its *output* dedup, not for its *input*
cost). That CLI calls `runTurnProfileProducer`
(`extension/src/metrics/turnProfileProducer.ts`), which for every role:

1. `listTranscriptJsonlPaths` (`transcriptUsage.ts:124`) lists **every**
   `.jsonl` file ever written under that role's `~/.claude/projects/<slug>/`
   directory — no time bound, no cursor.
2. `buildTurnProfileWindowForGroups` → `walkTranscriptFiles` reads and fully
   JSONL-parses every one of those files, every tick.
3. The only "idempotent" part is `filterNewTurnProfileWindows` deciding
   whether to *upsert a new row* into `turn-profile-series.jsonl` — it never
   feeds back into what gets *read*. Yesterday's already-recorded transcripts
   are re-read and re-parsed exactly as fully as today's new ones, forever.

The code's own comment already names the shape without treating it as a
risk: *"the walk's window widens on every daemon tick (the transcripts keep
growing)."* That is an accurate description of an unbounded-cost sweep.

## Evidence this is real, not theoretical

Measured live tonight (2026-09-07), a `handoffd` "stalled" death
(`.swarmforge/daemon/handoffd-failure-20260907T180330Z.log`) whose sweep log
shows `turn-profile-producer-sweep ms=38876` — 38.8 **seconds** for one
sweep, an order of magnitude past every sibling sweep in that same cycle
(the next slowest, `post-qa-branch-sweep`, ran 10-16 s). Host-level telemetry
around the same time (`chaser-2026-09.jsonl` resource/host_load samples)
shows no CPU/memory contention (host load ratio 0.35, all role CPU% single
digits) — ruling out host starvation as the cause of that specific slowness;
the cost is intrinsic to the sweep's own unbounded input.

Current transcript volume on this host (`~/.claude/projects/*/*.jsonl`,
counted per role worktree):

| Role worktree | files | size |
|---|---|---|
| coder | 271 | 413 MB |
| QA | 213 | 271 MB |
| documenter | 243 | 217 MB |
| architect | 209 | 230 MB |
| hardender | 198 | 244 MB |
| cleaner | 192 | 179 MB |

Over 1.5 GB of JSONL re-read and re-parsed in full, every handoffd cycle,
across just these six roles - and every role-session restart (frequent -
crashes, `./swarm ensure`, redeploys, expedite runs each spawn fresh
transcripts) adds another file that is never dropped from the walk.

## Why this matters now, not just eventually

`turn-profile-producer-sweep` runs in the same sequential daemon loop as
every other sweep (chase-sweep, post-qa-branch-sweep,
master-main-reconcile-sweep, etc.). A single cycle's cumulative sweep time
counts against `SUPERVISOR_IN_SWEEP_BUDGET_MS` (225000 ms default) before
the supervisor marks the daemon `stalled` and BL-144's `halt-swarm!` kills
every role session (the exact mechanism BL-1454 already exists for, for a
different sweep). Tonight's death was not conclusively pinned on this one
sweep alone - `master-main-reconcile-sweep` also hit a real merge conflict
with `Unable to write index` in the same failure window - but a 39-second
single sweep is a real, substantial, and **permanently growing** contributor
to that budget, on a trajectory that only gets worse the longer this swarm
runs, exactly like BL-1454's shape before it became critical.

## What's wanted (direction, not mandate — mirrors BL-1454's own remedy)

- Bound the walk: persist a cursor (last-processed file + byte offset, or at
  minimum last-processed mtime/window boundary) per role, so a tick's cost
  scales with *new* transcript content since the last successful run, not
  with the total lifetime volume.
- Keep `buildTurnProfileSeries`'s existing one-row-per-day upsert semantics
  (`TurnProfileWindowRecord.window_day`) - this is about bounding what gets
  *read*, not changing what gets *recorded*.
- A tick's own deadline/cap, same posture BL-1454 added to
  `coordinator-activity-feed-sweep!` - do not assume dedup-on-write is
  sufficient cost control for an unbounded-on-read walk.
- Audit whether `context-telemetry-producer-sweep!` (the sibling sweep
  immediately above this one in `handoffd.bb`, walking "the same
  transcripts") shares the identical unbounded-read shape - out of scope to
  fix here, but worth naming rather than leaving for someone else to
  rediscover independently.

## Out of scope

- The `master-main-reconcile-sweep` merge-conflict/"Unable to write index"
  finding from the same failure log - a separate, not-yet-confirmed-causal
  thread; not folded into this ticket.
- Re-litigating BL-1454's own fix (already landed, done) - this is a
  sibling defect of the same shape, not a regression of that ticket.
- Auditing every other handoffd sweep for the same shape wholesale (BL-1454
  itself named this as a followup, not a mint-time requirement).

---

## Disposition (specifier, 2026-09-07)

Minted 1:1 as `backlog/paused/BL-1476-the-turn-profile-sweep-reads-only-what-changed.yaml`
(`type: defect`, `severity: high`, `human_approval: pending`), with this
intake's "What's wanted" and "Out of scope" carried verbatim (Article 5.3).
The sibling audit the intake asked for was done at mint and found the
context-telemetry producer sweep throwing on a NUL-filled torn tail of its
own store on every cycle since 2026-08-30, unlogged: minted as
`backlog/paused/BL-1477-the-context-telemetry-producer-records-again.yaml`
(the dark producer, bounded un-darkening) and
`backlog/paused/BL-1478-a-compiled-tool-sweep-never-fails-silently.yaml`
(the silent non-zero exit). The sibling's adoption of BL-1476's change
detection is recorded on the swarm-reliability epic BL-539's
`remaining_slices`. Measurements:
`backlog/evidence/BL-1476-BL-1477-BL-1478-specifier-mint-measurements-20260907.md`.
This intake moves to `backlog/archive/`.
