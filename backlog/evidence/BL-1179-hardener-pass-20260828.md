# BL-1179 hardener pass — 2026-08-28

## Coverage / CRAP
`extension/src/tools/agentMemoryVendorAdapters.ts`: a plain `node scripts/crapReport.js`
without a preceding coverage run reads every function at 0% coverage
(no `coverage/coverage-final.json` yet in this worktree) — not a real gap,
just the report needing its input generated first. Ran
`npx vitest run --coverage test/agentMemoryVendorAdapters.test.js` first;
re-ran CRAP: all 6 functions at 100% coverage, CRAP 1.00-5.00, all ≤6 — no
change needed.

## Mutation hardening (hand-authored — Stryker's whole-suite dry run blocked)
`npx stryker run --mutate out/tools/agentMemoryVendorAdapters.js` requires a
green whole-suite Vitest dry run (perTest coverage analysis). This worktree's
dry run fails immediately on an unrelated, already-filed defect:
`pilotMkdtempConventionCheck.test.js` / `pilotAcceptanceGateCli.test.js`
crash with `Cannot find module '.../test/helpers/rawMkdtempGuard'` because
`assessPilotMkdtempConvention` resolves its detector through the SUBJECT
root instead of the tool's own location — **BL-1209**
(`backlog/paused/BL-1209-...yaml`), already filed, same blocker BL-1228 hit
earlier today. Not fixable within this ticket's scope.

Ran a hand-authored mutation sweep instead (tooling-unavailable fallback,
same posture as BL-1228/BL-1230 today). Applied each mutant to
`src/tools/agentMemoryVendorAdapters.ts`, recompiled, ran both the unit
suite (`test/agentMemoryVendorAdapters.test.js`) and the property suite
(`test/agentMemoryVendorAdapters.property.test.js` via
`vitest.properties.config.mjs`), confirmed a failure, then reverted
(confirmed byte-identical via `diff` after every mutant and at the end):

1. `vendorPairUnsupportedReason`'s outgoing-unsupported guard removed → 2
   unit + 1 property test failed.
2. `vendorPairUnsupportedReason`'s incoming-unsupported guard removed → 1
   unit test failed.
3. `unsupportedVendorMatrix`'s self-pair skip (`outgoing.runtime ===
   incoming.runtime`) removed → 1 unit test failed.
4. `transferMemoryAcrossVendors`'s `if (reason)` refusal guard removed → 2
   unit + 2 property tests failed.
5. `runtimeMemoryAdapter`'s fail-closed fallback for an unrecognised
   runtime flipped to `supported: true` → 1 unit test failed.
6. The `aider` table entry flipped to `supported: true` → 4 unit + 1
   property test failed.
7. `transferMemoryAcrossVendors`'s delegation hardcoded to a fixed role
   string instead of passing `role` through (invariant 2: the delegation
   must be verbatim) → unit suite did NOT catch it (15/15 green — no test
   asserts the specific role value reaches the delegate), but the property
   suite did (1/3 failed) — the load-bearing check for this branch is the
   property test, as the ticket's own notes anticipated for invariant 2.

All 7 valid mutants killed (6 by the unit suite, all 7 by the combined
unit+property suites). One additional mutant attempt (reformatting the
delegation's return value) was not type-valid against `MemoryTransferOutcome`
and was dropped rather than forced.

## DRY
`npx jscpd src/tools/agentMemoryVendorAdapters.ts --threshold 1` — 0 clones.

## Verification
- `npx vitest run test/agentMemoryVendorAdapters.test.js` — 15/15 green.
- `npx vitest run --config vitest.properties.config.mjs test/agentMemoryVendorAdapters.property.test.js` — 3/3 green.
- `run_acceptance.sh specs/features/BL-1179-cross-vendor-memory-adapters-unsupported-matrix.feature` — 3/3 green.
- Confirmed the `required_wiring` anchor is live: `agentMemoryVendorAdapters.ts`
  imports `AgentMemoryTransferApi`/`runMemoryTransferForRole` from
  `agentMemoryHotSwap.ts` and delegates through it, not an island.
- Acceptance step file (`bl1179CrossVendorMemoryAdapterSteps.js`) creates no
  filesystem fixtures — no leak risk to check here.

## Cleanup
No orphaned test/mutation processes. All hand-mutation probes reverted and
confirmed byte-identical to the pre-probe file.

By hardener.
