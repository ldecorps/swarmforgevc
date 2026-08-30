# BL-1277 — cleaner pass

Cleaner, 2026-08-30. Merged coder's `37842890e9` (commit
`e8bafb136` after resolving two add/add-shaped conflicts in `backlog/paused/`
YAML files — both were independent duplicate mints/notes reaching my branch
and the coder's branch by different paths; my copy was a strict superset in
both cases, kept mine).

## Verification

- `npm run compile` clean.
- `node specs/pipeline/cli.js specs/features/BL-1277-...feature` → 5/5.
- The two features the ticket names as RED on `main` today, re-checked here:
  `BL-1268-stale-claim-branch-must-name-this-ticket.feature` → 7/7 (was 2/7),
  `BL-378-no-single-file-bounds-the-suite.feature` → 4/4 (was 3/4). Both
  recover with no handler-logic or `.feature` file change, as the ticket
  predicted.
- `extension/test/bl1277UnscopedStepCollisionGuard.test.js` → 6/6.
- `extension/test/bl1277StepCollisionInvariants.property.test.js` (properties
  lane) → 5/5, both invariants (exhaustive over the ambiguous corpus, and a
  sampled non-vacuity check) green.
- Full `vitest run --config vitest.config.mjs`: 219 failures across the same
  27 files as before this merge (bridgeServer, epicReorderBridge,
  pausedPagerBridge, pilotAcceptanceGate, etc.) — pre-existing, standing,
  unrelated to step-registry/collision code; this parcel neither adds to nor
  reduces that count (same figure the coder's own evidence recorded).

## Code review

- `specs/pipeline/stepRegistry.js`: the only addition is a read-only
  `listDefinitions()` accessor; `resolve()`'s own logic is untouched, per the
  ticket's constraint against re-cutting resolution semantics.
- `extension/test/helpers/stepCollisionGuard.js`: single-responsibility
  functions (`shippedStepFiles` / `registrationsByFile` /
  `findUnscopedCollisions` / `formatRefusal` / `collisionVerdict`), thin
  `main()` over exported helpers, child-process isolation for the shipped-repo
  verdict with the reason documented inline (loading ~800 step files pulls in
  `node:test`, which would otherwise derail vitest's own collection) — matches
  the CLI-thin-wrapper and testability conventions already in force
  (`materializedRegistryGuard.js` precedent, reused directly for
  `findExtensionRoot`, not re-derived).
- The 16 per-file `BL1277_FEATURE_NAME` + local `defineScoped` wrapper is a
  repeated SHAPE, not duplicated logic — each constant's value is that file's
  own feature title (data, one line, correct per file), and each file is
  already an independent module in this codebase's established convention (a
  local `FEATURE`-style constant per steps file, referenced in the ticket's
  own "How" section). Not a DRY finding.
- No `extension/src/**` files changed, so CRAP/mutation/DRY gates don't apply
  here (Design And Testability: acceptance/pipeline step files and their unit
  tests are outside those tools' scope, same basis as BL-1274's cleaner pass).

## Architecture

No layering concerns: the guard is a pure, testable module consumed by three
lanes (vitest, both property tests, this ticket's own acceptance steps) —
exactly the "one enumeration, one verdict path" the coder's own comment
states, and correctly depends inward on `stepRegistry.js`'s public
`listDefinitions()`, not on step-file source text.

Forwarding to architect.
