# BL-923 hardener pass — 2026-08-19

## Reviewed commit
`c2a2d27beb` (architect merge, clean sweep — see
`backlog/evidence/BL-923-dwell-union-fold-architect-pass-20260819.md`).
TypeScript under `extension/src`, so per the ticket's own notes ("Degraded
gating does not apply") mutation, CRAP and DRY all run — no fallback.

## Checks run (complete inventory, not first-failure-stop)

1. **Leftover process/fixture check before starting**: clean, nothing
   stray in this worktree.
2. **Compile**: `npm run compile` clean, no errors.
3. **Unit suite**: `npx vitest run test/closingCeremony.test.js` — 31/31
   pass, independently re-run (not just trusted from architect's report).
4. **Property tests**: `test/closingCeremonyDwellOccupancy.property.test.js`
   run against `vitest.properties.config.mjs` directly (the full
   `test:properties` command hits this sandbox's ~120s cap on an unrelated
   slow property under today's load, same as this session's BL-585 pass) —
   2/2 pass.
5. **Acceptance**: `run_acceptance.sh
   specs/features/BL-923-dwell-counts-occupied-time-not-parcel-sum.feature`
   — 5/5 scenarios pass (4-row Outline + ranking scenario).
6. **DRY** (`jscpd --config .jscpd.json src/quality/closingCeremony.ts`):
   0 clones found.
7. **CRAP** (`npm run coverage` scoped to the parcel's own test file +
   `node scripts/crapReport.js src/quality/closingCeremony.ts`, against
   `src/*.ts` per the CRAP-scoping rule): every function <= 6.00,
   including the three new/changed ones — `eventOccupancyInterval`
   (complexity=5, CRAP=5.00), `sumOccupiedMs` (complexity=5, CRAP=5.00),
   `computeDwellHotspots` (complexity=4, CRAP=4.00). Exit 0, zero
   `CRAP > 6` flags. Nothing to fix.
8. **Mutation (both mechanisms) — DEFERRED, host busy**: BL-149 cooldown
   gate (`SWARMFORGE_MUTATION_GATE_FORCE_CORES=4`) returned `skip-busy`
   on every check across this pass (`load_avg` 17.6-19.3 against
   `busy_threshold` 8, sustained — not a momentary blip like earlier this
   session, `uptime` held 16-19 across three separate checks a minute
   apart). Feature has one `Scenario Outline`, so BL-113 applies in
   principle, but is bound by the same load rule as Stryker. Per the
   load rules binding every mutation runner, and consistent with this
   same worktree's BL-585/BL-915 passes earlier today under the same
   conditions: BOTH Stryker mutation and BL-113 Gherkin acceptance-
   mutation deferred to the next quiet-host pass rather than risking a
   dry-run crash / flat-CPU stall. "Degraded gating does not apply" (the
   ticket's own note) means the tooling is real and wired for this
   TypeScript file — it does not override the load-safety deferral, which
   is an operational rule, not a tooling-availability one. Neither ran;
   neither recorded as passed.

## Outcome
No defects. CRAP and DRY both clean on the changed/new code — nothing to
fix. Mutation (Stryker + BL-113) BLOCKED BY sustained host load (BL-149
gate `skip-busy` throughout); deferred, not skipped silently — owed on the
next quiet-host pass, same class as BL-915/BL-585 and the systemic gap
tracked in BL-941/BL-942.

Forwarding to documenter.

By hardener.
