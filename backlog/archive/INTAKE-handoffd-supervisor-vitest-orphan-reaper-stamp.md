# Raw intake — Cursor-agent hotfix: property-lane vitest orphan reaping needs swarm stamp

Status: new intake, not minted. Capture only (human via Cursor, landed
uncommitted in the master checkout across FIVE related files, found by
the coordinator during a 2026-08-12 host-load investigation and committed
for provenance in two commits: `602c7d014` (handoffd_supervisor.bb alone,
found/committed first) and `1ecbe049f` (the remaining four files, found
moments later once the fuller scope became visible via `git status`).
Same posture as BL-811 / BL-849 / BL-879: commit makes it reviewable;
this intake asks the swarm to review-stamp it through the normal chain,
not to re-implement from scratch.

Note on discovery: the coordinator's first commit (`602c7d014`) covered
only `handoffd_supervisor.bb` because that was the one file the babysitter/
human conversation had named. The other four files (all part of the SAME
coherent change — `orphan_janitor_lib.bb`, `orphan_janitor_sweep_lib.bb`,
their two new test files, and `propertyLaneFixtureRunner.js`) were only
discovered when a `commit_integrity_cli.bb` retry's `git status` output
surfaced them. Reviewers should treat both commits as one logical unit.

Related (do not conflate)
- **BL-871** (active) — property-lane worker-pool cap. This hotfix is
  adjacent (it reaps crash-orphaned property-lane processes after the
  fact) but does not implement BL-871's own fix (capping the pool up
  front). Complementary, not overlapping.
- **INTAKE-orphan-janitor-caffeinate-dims-reclaim.md** (filed same shift,
  not yet minted) — a separate orphan-reclaim gap on the same general
  theme (leaked long-running processes), different subsystem
  (`orphan_janitor_lib.bb` vs. this ticket's `handoffd_supervisor.bb`
  crash-orphan reaper) and a different process class (`caffeinate -dims`
  vs. Stryker/`node --test`/vitest job groups). Do not fold together.
- **BL-108** (done) — original crash-orphan reaper this hotfix extends.

## Goal

1. Specifier mints a **high** defect / swarm-review ticket (BL-811/BL-849/
   BL-879 shape): verify the human-landed reaper extension is correct,
   guarded, and wired; stamp it off through the normal chain.
2. Acceptance must prove: (a) a crash-orphaned property-lane vitest
   process group (matching `vitest.properties.config.mjs`, `npm exec
   vitest`, `npx vitest`, or a `(vitest ...)` worker cmdline, reparented to
   launchd/dead-parent) is now reaped where it previously was not; (b) a
   still-owned (live parent) property-lane run is never touched, however
   long it runs; (c) `job-in-scope?`'s cwd-based match doesn't widen scope
   to processes outside the host root / registered worktrees.
3. Confirm `process-table-lib/parent-orphaned?` is the same helper BL-849/
   BL-877 already hardened for cross-platform (macOS `/proc`-free)
   liveness — this hotfix should be reusing it, not re-deriving orphan
   detection a second way.
4. Resolve whether `handoffd_supervisor.bb`'s `job-in-scope?` and
   `orphan_janitor_lib.bb`'s `project-scoped-path?` are meant to be two
   independent scoping checks (crash-orphan reaper vs. periodic sweep are
   genuinely different subsystems) or should share one helper — as
   landed they're separate implementations of the same idea and could
   silently drift.
5. Confirm the two new test files actually run under a standing gate
   (grep the suite runner / CI-equivalent wiring), not merely added.
6. Confirm the fixture-runner's new `exit`/`SIGINT`/`SIGTERM` handlers
   don't double-fire or leak listeners across repeated
   `runAsPropertyLaneFixture` calls within one process (handlers are
   installed once via a guard flag — verify that guard is correct under
   concurrent/repeated use).

## What landed (Cursor agent, exact date/time unconfirmed — found
## uncommitted in master's working tree at 2026-08-12 ~10:03 CEST)

### `swarmforge/scripts/handoffd_supervisor.bb` (commit `602c7d014`)

- Loads `process_table_lib.bb` (new require).
- `job-process-pattern` regex widened from `stryker|node --test` to also
  match `vitest\.properties\.config\.mjs`, `npm exec vitest`, `npx
  vitest`, and `(vitest` worker cmdlines.
- New `job-scope-paths` — canonical host root plus every registered role
  worktree path.
- New `job-in-scope?` — true when a candidate's cmdline OR cwd (via
  `process-table-lib/cwd!`) is rooted under one of those paths; vitest/npm
  invocations often omit the checkout path from argv, so the cwd check is
  load-bearing, not redundant.
- `orphaned-job-groups` rewritten to use `process-table-lib/parent-
  orphaned?` (PPID 1, dead parent, or missing ProcessHandle) instead of a
  raw `= 1 ppid` check, and to call `job-in-scope?` instead of the old
  bare `str/includes? cmd worktree` substring match.

### `swarmforge/scripts/orphan_janitor_lib.bb` / `orphan_janitor_sweep_lib.bb` (commit `1ecbe049f`)

A parallel, independently-wired extension of the SAME class of problem in
the periodic janitor sweep (not just the crash-orphan reaper above):

- New `hung-vitest-cmdline?` — same vitest/npm cmdline patterns as above,
  plus a `node.*/vitest/` path match.
- New `project-scoped-path?` — reads `.swarmforge/roles.tsv` column 3 to
  build the canonical host-root + worktree path set, checked against both
  cmdline and cwd (mirrors `job-in-scope?` above but is a separate
  implementation — reviewers should confirm this doesn't drift from
  `handoffd_supervisor.bb`'s version over time, or note if they were meant
  to share one helper).
- New `reapable-hung-vitest?` — same shape as the existing
  `reapable-hung-acceptance?`: a parent-orphaned root reaps immediately
  (bypassing the age gate, same fast-path posture as BL-849's front-desk
  fix), a still-live-parented one waits out `vitest-stale-threshold-ms`
  (new, env-overridable via `SWARMFORGE_ORPHAN_JANITOR_VITEST_STALE_HOURS`,
  default 2.0h).
- `sweep-candidates!` now threads `project-root` through (new required
  first arg — an internal signature change, verify every call site
  updated) and adds a `cwd!` adapter alongside the existing `cmdline!`
  one.
- Two new test files: `orphan_janitor_lib_test_runner.bb` (60 new lines)
  and `test/test_handoffd_supervisor_job_reaper.sh` (50 new lines) —
  confirm these actually run under a standing gate, not just added and
  never wired (BL-419 shape).

### `extension/test/helpers/propertyLaneFixtureRunner.js` (commit `1ecbe049f`)

- Generated property-lane fixture test files are now tracked in a module-
  level `Set` and removed via `process.on('exit'/'SIGINT'/'SIGTERM')`
  handlers, not only the previous `finally` block — a `finally` never
  runs on `SIGKILL` or an unhandled crash, so a fixture file could
  previously survive an abnormally-terminated property-lane test run.
  Directly relevant to today's severe-host-load shift, where abnormal
  terminations of property-lane runs are more likely, not less.

### Why this matters (coordinator's own investigation, same shift)

Host load was observed climbing to 259/249/203 during today's shift with
132-of-560 processes runnable at once on a 4-core host, traced substantially
to concurrent, uncapped property-lane vitest runs (BL-871's own defect).
A crash-orphaned property-lane process group left behind by an
interrupted run would previously NOT have been reaped by this daemon (the
old pattern didn't match vitest at all) — this hotfix closes exactly that
gap, independent of whether BL-871's pool cap has landed yet.

## Out of scope for this stamp ticket

- BL-871's own pool-cap fix (separate active ticket).
- Any change to `process-table-lib.bb` itself — this ticket only consumes
  its existing `parent-orphaned?`/`cwd!` helpers.
- Widening the reaper to any process class beyond Stryker/`node --test`/
  vitest-property-lane (already the full scope of this hotfix).

## Locked human decisions

1. Treat this as **swarm-review stamp-off of a landed hotfix**, not a
   greenfield implement ticket (same posture as BL-811/BL-849/BL-879).
2. Severity **high** — a crash-orphaned property-lane run is currently
   invisible to the daemon's own reaper, compounding the same host-load
   problem this shift already flagged twice.

---
MINTED 2026-08-12 by the specifier as BL-886 (backlog/paused/BL-886-swarm-stamp-vitest-orphan-reaper-hotfix.yaml). Locked human decisions carried verbatim into that ticket's notes (Article 5.3).
