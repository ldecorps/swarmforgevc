# BL-971 amendment slice (bl760 + shared budget): measurements and determinations (2026-08-20, coder)

Amendment 3a15ebffe added bl760DuplicateChainGuard to the ticket: it
exhausted the SHARED `SUBPROCESS_HEAVY_TIMEOUT_MS` (240000ms,
extension/test/helpers/subprocessHeavyTimeout.js) in the hardender's
full-lane run (note 20260820T121826Z_000276). The two originally-named
files were already fixed and landed (main commit 88c23d1ea).

## Before (the defect, three independent measurements)

- Hardender full-lane run 2026-08-20: bl760 timed out at 240s - the whole
  shared subprocess-heavy budget (the amendment's trigger).
- QA 2026-08-11 (recorded in the file's own BL-871 comment): properties
  finishing at up to 162757ms under contention.
- This slice, 2026-08-20: a scoped run of the PRE-rework file under live
  load was still incomplete after ~15+ minutes when the harness reaped the
  detached process (no verdict line; recorded as an observation of
  severity, not a number); a post-fixture-hoist-only intermediate run
  measured test 1 at 301s (sync-blocked past its 240s budget), test 2 at
  224s, test 3 at 119s - i.e. even with the per-draw git fixture spawns
  removed, 40-draw properties remain arithmetically unfittable under load.

## Per-draw cost (measured, the basis for every number in the fix)

- Floor: 2.2-3.1s per draw over 5 consecutive live single-draw
  measurements (one fixture reset + one seeded blocker + ONE real refused
  `bb swarm_handoff.bb` send - the send IS the system under test and its
  cost is irreducible per draw).
- Loaded (inside a scoped vitest run with concurrent suites): 5.6-7.5s per
  draw (224s/40 and 301s/40 observed).

## The fix mix (per the ticket: coder owns the mix, acceptance owns the outcome)

1. Fixture hoist: the git fixture repo is draw-invariant; it is now built
   ONCE per test and every draw resets only the mutable surface (role
   dirs + root handoffs dir), each removal asserted gone. Removes ~5 git
   subprocesses per draw (~600 across the old file's 120 draws).
   swarm_handoff.bb's send-path write surface was checked against the
   reset (handoff_lib.bb write sites): all send-path writes land under
   the dirs the reset clears.
2. Invariants 1+2 merged into ONE property: their draw shapes were
   byte-identical (same fixture, same seeded blocker, same duplicate
   send); only the assertions differed. One send now carries BOTH labeled
   assertion groups - half the subprocess count, zero assertion loss, and
   every draw now checks more than either old test did alone.
3. numRuns 40 -> 16 per property, with the measured rationale above: the
   discrete space the dup-chain scan branches on (held state x held-slug
   presence x sent-slug presence = 8 combos; sender identity does not
   reach the scan) stays expected-covered ~2x per run with all ranges
   unchanged, and 16 x 7.5s worst = 120s vs the UNCHANGED shared 240s
   budget = ~2x headroom at the worst measured rate (~40-50s at the
   floor). The shared constant itself is untouched - no budget inflation,
   and the three other adopters (bl787, bl797, onboarderLauncherPidGuard)
   are unaffected.

## Non-vacuity (staged-first restore, this slice)

- The BL-760 landing's invariant-1 break re-run against the reworked
  harness: dup-chain-block arm disabled in swarm_handoff.bb's cond-> ->
  the merged property failed on its FIRST draw on the invariant-1 refusal
  assertion (counterexample ["coder","1",undefined,undefined,"new"]).
  Restored (file byte-identical to HEAD), green runs follow below.

## After (two consecutive scoped runs, live load - qa_e2e step 1)

- Run 1: 2/2 green, whole file 95.5s (merged property 44.8s, distinctness
  48.8s - ~2.8-3.0s/draw, the measured floor rate).
- Run 2: 2/2 green, whole file 69.3s (merged 30.9s, distinctness 37.2s).
- Zero wall-clock exhaustions either run; worst per-test 48.8s vs the
  unchanged 240s shared budget (~5x at the observed rate, ~2x guaranteed
  at the worst measured loaded rate).

## BL-935 cap determination (qa_e2e step 4)

- SWARMFORGE_PACK=full-forge was live in this role's own shell env AND in
  tmux global env during every measurement above (probed directly, per
  the pane-own-env lesson), so vitest.properties.config.mjs's
  resolveVitestWorkerPool cap WAS engaged for the vitest runs here.
- For the hardender's original bl760-exhausting full-lane run: engagement
  is INDETERMINATE from the note alone - same posture the prior BL-971
  parcel recorded for QA's original failing run.

## BL-984 confound (stranded lane fixtures)

- Re-checked this worktree at slice time: zero bl868-fixture-*/
  bl760-fixture-* strays under extension/test/ - the measurements above
  carry no stranded-fixture inflation.

## Runtime-drop tracing (qa_e2e step 5)

- The drop traces to: ~600 removed per-draw git spawns, 40+40 -> 16
  merged draws each doing strictly MORE assertion work per draw, and
  16-vs-40 draws on the distinctness property with its collision-pair
  construction untouched. Generator arbitraries are byte-identical
  throughout; no range narrowed.
