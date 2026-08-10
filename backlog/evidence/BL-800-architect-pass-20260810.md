# BL-800 architect review — clean pass, NONE

**Ticket:** BL-800 — BL-623's acceptance false-fails under the full step
registry: BL-606's earlier, unscoped generic `/^the parcel is delivered to
(.+)$/` shadowed BL-623's exact `/^the parcel is delivered to QA$/`
registration (first-match-in-registration-order), so scenarios 02/04
false-failed dereferencing `ctx.bounceHandoff` on a baseline where no bounce
is ever sent.
**Reviewed commit:** a53e6f3754 (coder, forwarded unmodified by cleaner as
`merge_and_process cleaner a53e6f3754`).
**Role:** architect.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** Only
   `specs/pipeline/steps/bl623RoutingSkipTrailSteps.js` and
   `extension/test/bl800StepRegistryScopingConsistency.property.test.js`
   changed — neither under `extension/src` or `extension/media`. Confirmed
   by running `dependency-gate.js` directly against both — same "can't open"
   scope error as BL-812/BL-798's precedent. NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against both files — no result reaches the tool's own min-frequency
   threshold (3); nothing flagged as SUSPECTED COUPLING. The top hits
   (bl606RequiredStagesRoutingSteps.js, index.js, bl623Only.js, the
   acceptance-contract-gate family) are exactly this subsystem's known
   existing shape, at frequency 1-2.

3. **Two-layer / IO-ownership / integrate-not-fork rules:** not implicated —
   spec-harness step-registration files and a property test, not the
   extension host, webview, or upstream SwarmForge source.

4. **Fix mechanism, verified against the actual registry code
   (`specs/pipeline/stepRegistry.js`, read in full, confirmed byte-for-byte
   unchanged — respects the ticket's own out-of-scope list):**
   `defineScoped(pattern, handler, featureName)` was already a live BL-425
   mechanism (`resolve(stepText, featureName)` already receives
   `feature.name` from `runtime.js:22`, confirmed by grep) — this parcel is
   the first *consumer* of an already-wired scoping path, not new dispatch
   semantics. `FEATURE_NAME` in both the fix and the property test is
   byte-identical to the real `Feature:` title
   (`specs/features/BL-623-routing-skip-trail-records-actual-hop.feature:1`,
   confirmed by grep) — a mismatched string here would silently fall back to
   the unscoped path and reintroduce the exact bug being fixed.
   `bl606RequiredStagesRoutingSteps.js` is untouched (confirmed by name-only
   diff) — its own generic pattern and feature are unaffected, per the
   ticket's own e2e step 4 and out-of-scope list.

5. **Declared invariant (BL-654 — single invariant, one pass):** "the
   focused entry point and the full registry resolve every step of every
   scenario to the same handler." Property test
   (`bl800StepRegistryScopingConsistency.property.test.js`) is genuinely
   generative (fast-check `fc.property`/`fc.constantFrom` over every real
   step of every real BL-623 scenario, built from the real gherkin-parser via
   `runnerAdapter.js`/`resolve_contract_steps.js`/`runtime.js` — never a
   hand-rolled IR walk), compares by `Function.prototype.toString()` source
   equality (correctly reasoned: reference equality is meaningless across
   two independently-built registry instances), and carries a genuine
   non-vacuity companion test that reconstructs the pre-fix collision via a
   self-contained fixture registry (never touching the real, now-fixed
   files) and asserts the mismatch it would have caught. Re-ran both
   independently in this review (`npx vitest run
   test/bl800StepRegistryScopingConsistency.property.test.js --config
   vitest.properties.config.mjs`, after `npm run compile`): 2/2 pass. This is
   the standard I'd want for a new pure/testable invariant — no gap.

6. **e2e verification, re-run independently in this review (not just the
   ticket's own claim):**
   - `node specs/pipeline/cli.js
     specs/features/BL-623-routing-skip-trail-records-actual-hop.feature
     ./tmp/...` (no steps-module arg, i.e. the default full registry): 7/7
     pass.
   - Same feature through `specs/pipeline/steps/bl623Only.js`: 7/7 pass.
   - `specs/features/BL-606-specifier-declared-required-stages-routing.feature`
     through the default full registry: 18/18 pass — confirms the fix did
     not steal BL-606's own matches, exactly the ticket's own e2e step 4.

7. **Scope discipline:** every out-of-scope item the ticket names
   (`stepRegistry.js` dispatch semantics, a repo-wide shadowing audit,
   retro-fixing other latent collisions, the feature file's own scenarios)
   is respected — confirmed by the two-file diff and the unchanged
   `stepRegistry.js` content.

## Property Testing pass (architect-owned, undeclared properties)

The two touched files are a step-registration file and its own dedicated
property test — no other pure module was touched by this parcel. Nothing
further to add.

## Handoff

Forwarded to hardender, same task name, commit a53e6f3754 (per
`merge_and_process`, cleaner made no changes — architecture and the coder's
own invariant work are both clean).
