# BL-1348 — coder finding, 2026-09-06: raised default ceiling destabilizes
# `npm run test:properties` on a full-forge/Linux host

**Status:** parcel held, uncommitted. Not forwarded. Needs specifier/human
adjudication before I proceed.

## What I implemented (per `human_ruling`, option 2)

- `PER_WORKER_HEAP_MB`: 1280 → 640 (`extension/src/tools/vitest-worker-memory-budget.ts`),
  sized against a measured 298 MB peak fork footprint.
- Both `extension/vitest.config.mjs` and `extension/vitest.properties.config.mjs`
  now pass `defaultCeiling: os.cpus().length` into the existing
  `resolveVitestWorkerPool` composition (BL-935's one route, unchanged).
- All three declared invariants proven non-vacuous (break → fail → restore →
  pass), unit tests, and the acceptance feature (`specs/features/BL-1348-fork-pool-sizes-to-the-real-host.feature`,
  3/3) all pass cleanly.

This is exactly what the ruling asked for. The problem below is not a bug in
that implementation — it is a real, measured consequence of it on the host I
actually have to land on.

## What I measured

This host: `SWARMFORGE_PACK=full-forge`, `platform=linux`, 20 logical CPUs,
19904 MB RAM. `uptime` mid-session: load average 3.8 / 12.3 / 13.2 — this is
a live swarm host with several other agent sessions and node processes
(telegram bridge, front-desk bot, onboarder-reconcile pollers) already
running, not an idle box.

Before this ticket, on this exact host: `resolveVitestForkCeiling` falls
through to the hardcoded default `MAX_WORKERS = 6` (the full-forge-on-macOS
protection in the same function is gated on `platform === 'darwin'` and does
not fire here). Pool resolves to 6.

After this ticket: `defaultCeiling = os.cpus().length = 20`; with the new
640 MB heap, the RAM-derived `safeCount` is `floor(19904*0.5/640) = 15`,
so the pool resolves to **15** — 2.5x the prior default, with NO override
set (the ordinary case for every future coder/QA pass on this host).

I ran the full `npm run test:properties` (367 files) twice, back to back,
default ceiling both times (no `SWARMFORGE_VITEST_MAX_FORKS` set):

- **Run 1**: 4 files / 4 tests failed, all but one a plain
  `Test timed out in Nms` on subprocess-heavy (`bb`/git) property files
  (`bl1272LandedSiblingInvariants`, `bl1297MergeOwnPathsInvariants` invariant
  3, `bl968MaterializedGuardSensitivity` — this one already had an elevated
  300000ms timeout and still blew it). The fourth failure
  (`bl871PropertyLaneWorkerPoolCapInvariants`) was a **real, separate logic
  bug** in that test's own derivation (see below, fixed and kept).
- I bumped the three timeout-only failures' explicit timeouts as a first
  attempt, confirmed each passes alone well inside the old default 20000ms
  (bl1272 ~12s, bl1297 invariant 3 ~12s, bl968 ~180s), then re-ran the full
  suite clean.
- **Run 2** (same host, same no-override default, my timeout bumps still in
  place): **16 different files, 24 tests failed** — none of run 1's three
  timeout victims among them. Full list:
  `bl1012FreshnessSelfInflictedIncidents`, `bl1030RefusalCostsNothing`,
  `bl1108CursorSeatReadiness`, `bl1252CommitGuardAggregationInvariants` (6
  tests), `bl1297MergeOwnPathsInvariants` (invariants 1 and 2 this time, not
  3), `bl1304DryRunSpawnsNothing`, `bl1308SiblingDetectorCoversReplay`,
  `bl1309LandDecideEntanglementInvariants`, `bl1315OwnPathsFullRangeInvariants`,
  `bl1323StampOffInvariants`, `bl1343ReplayNeverDropsOwnPathInvariants`,
  `bl1354SharedPathLandedSiblingInvariants`, `bl1375ApprovedSiblingsCanLandInvariants`,
  `bl1389UnlandedSiblingPathNeverRidesInvariants`,
  `bl789MacHostSwitchFreshnessBridgeAdoptInvariants`,
  `telegramFrontDeskBotCli`. Almost all are the same class: a real
  git-repo-per-case or `bb`/CLI-subprocess-heavy property file, timing out
  under `testTimeout: 20000` when 15 forks contend for this host's real
  (shared, already-loaded) throughput.

I reverted the three timeout bumps (`bl1272`, `bl1297`, `bl968`) rather than
keep expanding them — run 2 proved that approach does not converge: it is a
different, larger set of victims each time, not a fixed list I can patch
once. Whack-a-mole timeout bumping is not a real fix here, and touching a
growing set of other tickets' declared-invariant property tests inside this
one commit is the wrong shape of change regardless.

## Why the commit-time self-heal (BL-1407) likely can't absorb this

`check_property_suite_drift.sh` already reruns a non-allowlisted failing
file alone before refusing (BL-1407), and every failure I checked in
isolation passed cleanly and fast. But that rerun path shares one **total**
wall-clock ceiling across every file it reruns in a single commit
(`rerun_ceiling_seconds`, default 180s —
`swarmforge/scripts/check_property_suite_drift.sh:149`). Run 2 alone would
need to rerun 16 files; `bl968` by itself measured ~180s alone (already
elevated once for exactly this reason, per its own file comment). Sixteen
files sharing one 180s combined budget will not all get rerun before the
ceiling trips, so the self-heal path is not a reliable backstop at this
failure volume — it was built for the occasional single flaky file BL-1370
hit, not a double-digit simultaneous cascade.

## Root cause, as best I can tell

`resolveVitestForkCeiling`'s only host-contention protection
(`pack === 'full-forge' && platform === 'darwin' → 1`) is gated to macOS.
It does not fire for a full-forge pack on Linux, even though this exact
host right now has the same shape of problem the macOS rule exists for:
several concurrent live agent sessions plus supporting node processes
contending for the same physical cores (load average 12-13 over the last
15 minutes, independent of my own test runs). Before this ticket, Linux
full-forge got an incidental, unprincipled safety net anyway, because the
fallback default was a conservative fixed 6. This ticket removes that
incidental protection by design (the whole point is to stop leaving cores
idle) and replaces it with the raw core count, which is correct for an
uncontended host and appears to be actively harmful for a contended
full-forge/Linux one.

## What I have NOT done

- Not committed or forwarded anything for BL-1348.
- Not changed `resolveVitestForkCeiling`'s pack/platform rule, the
  ruling's chosen numbers, or any other ticket's test file, beyond the one
  kept fix below.
- Not run the qa_e2e procedure's live `SWARMFORGE_VITEST_MAX_FORKS=12`
  check yet — holding until this is adjudicated, since that override
  resolves to 12 (vs. the pre-ticket clamped 7) and I expect the same
  class of failure at that concurrency too, just less of it.

## One fix kept regardless of the above (independent, real bug)

`extension/test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`
computed its own expected `WORKER_POOL_SIZE` via the bare
`resolveWorkerPoolSize(hostRamMB)` (default ceiling = `MAX_WORKERS`), which
no longer matches what `vitest.properties.config.mjs` actually resolves
(`resolveVitestWorkerPool` with `defaultCeiling: os.cpus().length`). On this
host that is 15 vs. the test's assumed 6 — the property immediately found a
real counterexample (9 concurrent workers observed, expected ≤6). Fixed by
deriving `WORKER_POOL_SIZE` the same way the real config does (mirrors the
config's exact composition, so the two can't drift the way they just did).
This fix is correct independent of the wider finding above and is staged
either way.

## Asking the specifier to adjudicate

This is the same kind of question BL-1336's human ruling already answered
for the darwin case, now surfacing for Linux under this ticket's own
default-raise. Options as I see them, not a recommendation:

1. Ship option 2 exactly as ruled, accept the measured instability, and
   open a follow-up to raise `rerun_ceiling_seconds` and/or the affected
   files' own timeouts broadly (a real, larger piece of work, not this
   ticket).
2. Extend the existing full-forge contention protection to Linux, not just
   darwin (a `resolveVitestForkCeiling` change, needs its own ruling since
   BL-1336's is darwin-specific and this ticket's own invariant 3 pins the
   darwin=1 behavior, not a Linux one).
3. Use a fraction of `os.cpus().length` rather than the raw count as
   `defaultCeiling` for the properties lane specifically (diverges the two
   lanes, which BL-935 invariant 3 currently forbids without a ruling that
   says so explicitly).
4. Revert to option 1 pending further data.

Holding the parcel until I hear back.
