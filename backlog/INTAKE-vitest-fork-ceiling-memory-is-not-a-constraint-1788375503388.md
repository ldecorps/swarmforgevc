# Intake: vitest property suite - raise the fork ceiling; memory is NOT a constraint on this host (human directive)

Filed by the Operator (2026-09-02, human-directed via Claude Code). Human's
words, verbatim: **"memory should not be an issue on this host."** Ask: make
`npm run test:properties` (and `npm test`) use the cores this host has.

## Measured (2026-09-02, full-forge live, 8 agents resident)

- `npm run test:properties`: **143 s wall**, 336 files / 870 tests, 532 s of
  summed per-file work, **6 forks** on a 20-core / 19.9 GB host.
- Fork cap comes from `extension/src/tools/vitest-worker-memory-budget.ts`:
  `PER_WORKER_HEAP_MB=1280` x `SAFE_HOST_RAM_FRACTION=0.5` -> floor(9952/1280)
  = 7, then `MAX_WORKERS=6`. `SWARMFORGE_VITEST_MAX_FORKS` is clamped by the
  same budget (override 8/12/16 all resolve to 7).
- Real footprint, sampled every 2 s during a full run: **peak 298 MB for the
  largest fork, 1.26 GB for all forks together**; 14 GB still available.
  The model over-reserves by ~4x. 14 cores idle for the whole run.
- Ideal at 6 forks = 89 s vs 143 s actual: the tail is serial spawn-heavy
  files. 106 of 306 files spawn real processes per fast-check sample and
  account for **428 s of the 532 s**. Worst: `onboarderLauncherPidGuard`
  79 s (15 samples x 7 spawns + a sleep - a hard floor for the whole suite),
  `bl1252CommitGuardAggregationInvariants` 37 s (5 x numRuns 120, spawning),
  `bl787NamedTunnelInvariants` 32 s.

## Directive (human) + how (direction, not mandate)

1. **Fork ceiling follows cores on this host, not the 15 GB-incident RAM
   model.** Honour `SWARMFORGE_VITEST_MAX_FORKS` above the RAM-derived cap
   (an explicit operator override is the operator accepting the memory risk),
   and/or size `PER_WORKER_HEAP_MB` from the measured ~300 MB (e.g. 640 with
   margin) so the default lands at ~cores/2 here. Keep the budget as a
   *warning*, not a clamp, when the human has overridden it. Same file
   BL-1336 (approved: fixed router ceiling) is about to touch - fold this in
   or sequence it right behind.
2. **Tame the spawn-heavy properties**: drop `numRuns` on properties whose
   body spawns a process (sampling a spawn 120x buys nothing over ~20x),
   remove sleeps, split the 30-80 s files so vitest can parallelise them.
   Target: no single file > 15 s.
3. Optional: two tiers - pure properties every parcel; process-spawning tier
   at hardener/QA only.

Expected result: ~40-50 s wall instead of 143 s, same coverage.

## Notes

- 17 pre-existing failures in the suite are all on the BL-1175 standing
  allowlist; unrelated.
- The bb property runners (e.g. master_main_reconcile_lib_property_runner.bb)
  are NOT the problem: ~1 s at 500 runs.

By operator.
