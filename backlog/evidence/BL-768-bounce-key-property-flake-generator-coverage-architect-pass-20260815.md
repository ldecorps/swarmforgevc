# BL-768 architect pass — 2026-08-15

## Scope

Received from cleaner as a second, separate `git_handoff` (task
`BL-768-bounce-key-property-flake-generator-coverage`) pointing at the same
tip commit `af2ca01dc2` as the BL-895 parcel — correct per Article 2.6,
since the cleaner's batch branch satisfies both tickets and sent one
`git_handoff` per ticket rather than collapsing them. Already merged into
this worktree while processing BL-895 (fast-forward, no new commit).

Commits in scope: `2b00319c8` ("BL-768: make bounce-key pair-generator
coverage structural, not luck", by coder) and `af2ca01dc2` ("Cleaner: dedupe
repeated field shape in bounceKeyPairArb.js").

Files touched: `extension/test/support/bounceKeyPairArb.js` (new),
`extension/test/bounceKeyPairArb.property.test.js` (new),
`extension/test/bounceNaturalKey.property.test.js` (consumes the extracted
module), `specs/pipeline/steps/bl768BounceKeyPairGeneratorCoverageSteps.js`
(new), `specs/pipeline/steps/index.js` (1-line registration).

## Correctness — verified hands-on, not taken on the coder's word

- Independently reconstructed the pre-BL-768 free-form-only generator from
  the parent commit and measured its coverage over 500 seeds myself:
  **7/500 misses (1.40%)** — exactly matching the commit message's claimed
  measurement. Measured the NEW `pairArb` the same way: **0/500 misses**.
  The fix is real, not merely claimed.
- Confirmed `PAIR_CATEGORIES` and `assertPairCoverage`'s message text are
  byte-identical to the pre-extraction version in
  `bounceNaturalKey.property.test.js`'s parent revision (diffed both) — the
  guard itself was not weakened, only how pairs are constructed changed,
  satisfying the ticket's explicit "a diff that... weakens
  `assertPairCoverage`/`PAIR_CATEGORIES` does not satisfy this ticket".
- Confirmed `extension/vitest.properties.config.mjs` (numRuns) was not
  touched by either commit — the ticket's explicitly-rejected "just raise
  numRuns" shortcut was not taken.
- Performed the ticket's own QA e2e step 4 by hand, against the REAL
  production `bounceNaturalKey` (not a synthetic proxy): patched
  `extension/src/quality/qaBounce.ts` to drop `by` from the key (coarser),
  recompiled, ran `bounceNaturalKey.property.test.js` — **failed**, 2/3
  tests red, correctly catching the coarsening via the restructured
  generator. Restored, patched again to keep the full `at` timestamp
  instead of just its date (finer), recompiled — **failed**, 1/3 red,
  correctly catching the finening. Restored the original source, recompiled
  clean, `git status` confirms no residual diff, re-ran the full property
  pair (`bounceNaturalKey.property.test.js` +
  `bounceKeyPairArb.property.test.js`): 7/7 green. This is the strongest
  form of non-vacuity evidence available — the restructured generator was
  tested against the actual production defect classes the ticket exists to
  catch, not a stand-in.
- Read `bl768BounceKeyPairGeneratorCoverageSteps.js` in full: every step
  drives the real `pairArb`/`classifyPair`/`assertPairCoverage` via
  `fc.sample` with fixed seeds (deterministic acceptance run); scenario 03's
  negative fixture has its own sanity check (`fixture error:` guard) proving
  the excluded category was actually present before filtering. Non-vacuous.
- Reviewed the cleaner's dedup diff (`RAW_FIELDS_SHAPE` extraction): purely
  mechanical, `recordArb`/`freeFormArb` consume the identical object shape
  either way. No behavior change, matches the commit message.

## Acceptance — re-run independently

`node specs/pipeline/cli.js
specs/features/BL-768-bounce-key-pair-generator-coverage.feature`: 7/7
scenarios pass (5 Examples rows + 2 plain scenarios, matching the feature
file and commit message).

`npx vitest run --config vitest.properties.config.mjs
bounceNaturalKey.property.test.js bounceKeyPairArb.property.test.js`: 7/7
green (3 + 4).

## Invariants review (BL-654)

Two declared invariants, both have coder-authored property tests in
`bounceKeyPairArb.property.test.js`, both non-vacuous:

1. *"Coverage is satisfied by construction, for every seed."* Property
   tests an arbitrary seed via `fc.integer()`, asserts `assertPairCoverage`
   on the resulting 100-sample draw. Non-vacuous by the ticket's own history
   (used to fail on ~2.6% of seeds) — independently reproduced above (7/500
   on the old generator, 0/500 on the new).
2. *"The restructured generator does not weaken what the property can
   catch — still exposes a coarser or finer key as wrong."* Property tests
   witness-existence against hand-defined `coarserKey`/`finerKey` helpers,
   plus a structural non-vacuity companion (an identity-only generator
   correctly produces zero witnesses). I additionally verified this
   end-to-end against the REAL production key function (see Correctness
   section above) rather than relying only on the synthetic helper
   reimplementation — the stronger check.

`required_wiring` (`bounceNaturalKey.property.test.js` consumes the
extracted module, not a second copy): confirmed by reading the import line
and diffing the three existing test bodies — behaviorally unchanged, now
sourced from `./support/bounceKeyPairArb`.

## Dependency-rule gate (BL-259, hard gate)

No changed file sits under `extension/src`/`media`. Full-repo mode reports
only the same pre-existing `telegram-front-desk-bot.ts` /
`telegramCursorOperatorExec.ts` / `telegramCursorOperatorLiveness.ts`
`acyclic` cycle already tracked as BL-759 and reproduced on every recent
architect pass (BL-895 earlier this session included) — no import path
between it and any BL-768 file. No violation attributable to this parcel.

## Co-change coupling (BL-255)

Ran against all 3 non-registry changed files
(`bounceKeyPairArb.js`, `bounceNaturalKey.property.test.js`, the new steps
file): each reports co-changes only with the other files this same pair of
commits touched (1 co-change apiece) — exactly the parcel's own footprint,
no external coupling. `index.js`'s registry pattern already judged benign
in prior passes (BL-826, and again this session for BL-895).

## Property testing pass (architect-owned, engineering.prompt)

The two declared invariants already cover the only property-shaped surface
this parcel touches (the generator itself). No additional pure module in
scope beyond what BL-654's invariant coverage already requires.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener. Article 4.4 explicit-NONE evidence
per the BL-806 review-forward-evidence gate (this commit, not the bare
received hash, is what gets forwarded).

By architect.
