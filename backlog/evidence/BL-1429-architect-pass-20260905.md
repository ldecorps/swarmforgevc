# BL-1429 — architect pass (redo after bounce), 2026-09-05

Ticket: BL-1429-standing-reds-throttle-intake
Role: architect
Commit reviewed: ce8602bf77 (cleaner, redo after my bounce)

## Result: NONE — the bounced finding is resolved; no other defect found

## What changed since my bounce

My earlier bounce (`backlog/evidence/BL-1429-bounce-20260905.md`) found
`describeChangeReason`'s clearing branch crediting the standing-red signal
for a cap clearing whenever `prior.standingRed` was merely present,
without checking it was ever the actually-binding (lower) cap — unlike
the active branch, which already ran that comparison. The coder's redo
applies the same `priorStandingCap <= priorReworkCap` comparison to the
prior tick that the active branch already applies to the current tick,
falling back to the original generic wording when standing-red was never
binding.

## Independently reproduced the fix, using my own bounce's exact repro

Re-ran the identical probe script from my bounce (severe rework at cap 0
+ co-active but non-binding standing-red count signal at cap 1, both
clearing together) against the fixed code:

```
tick1 recommendedCap: 0 severity: severe standingRed: { recommendedCap: 1, signal: 'count' }
tick2 recommendedCap: null
log entries:
{"from":null,"to":0,"reason":"severe rework diagnosis (rate 0.6 vs baseline 0.1) - freezing intake"}
{"from":0,"to":null,"reason":"rework diagnosis cleared - restoring the configured cap"}
```

Correct now — the clearing is attributed to the rework diagnosis, the
actual binding cause throughout, not the merely co-active standing-red
signal.

## Independently confirmed non-vacuity myself (not just trusted)

Backed up `emit-throttle-recommendation.ts`, reverted the clearing branch
to the pre-fix bare `prior?.standingRed` truthiness check, recompiled, and
reran `emitThrottleRecommendationStandingRed.test.js`: the coder's new
regression test failed immediately, reproducing my exact bounce finding —
expected `/rework diagnosis cleared/`, got `"the red count cleared -
restoring the configured cap"`. Restored the file, recompiled, and
confirmed byte-identical via `diff` and `git status --short` (empty).

## Checks run

- **Dependency-rule gate**, full-repo: `Dependency-rule gate PASSED: no
  forbidden edges.`
- **Co-change report**: flags are all this ticket's own file family
  across its two implementation rounds (expected, informational only).
- **jscpd**, independently re-run on all seven touched/new files: `0
  clones` — confirms the cleaner's DRY fix continues to hold.
- **mutation-site-count**, independently re-run: `standingRedSignal.ts`
  94, `emit-throttle-recommendation.ts` 96 — both within the 100
  threshold, matching the cleaner's claim exactly.
- **Register check**: `backlog/standing-reds.tsv`'s only mention of
  BL-1429 is a header comment describing the throttle mechanism this
  ticket builds, not a data row it owns — nothing to reconcile.

## Independently re-verified the substance

- `npx vitest run test/standingRedSignal.test.js
  test/emitThrottleRecommendationStandingRed.test.js
  test/emitThrottleRecommendationCli.test.js` — **36/36 pass** (11 + 9 +
  16), matching the evidence exactly.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1429StandingRedThrottleFoldInvariants.property.test.js` —
  **4/4 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-1429-standing-reds-throttle-intake.feature` —
  **8/8 pass**.
- `node specs/pipeline/cli.js
  specs/features/BL-432-auto-tune-intake-throttle.feature` (regression on
  the shared emitter) — **5/5 pass**, unaffected.

## Invariants Review (BL-633/654) — re-verified live

1. **Invariant 1** ("the emitted recommendation is the minimum of the
   rework recommendation and the standing-red recommendation... only the
   two named caps") — `minRecommendedCap` unchanged from the original
   pass, confirmed still correct; property test invariant-1 pass.
2. **Invariant 2** ("every change of the recommended cap is logged with
   the signal that caused or cleared it... a recommendation that persists
   unchanged logs nothing") — the bounced gap in the clearing branch is
   now closed and independently confirmed above; property test invariant-2
   pass (still isolated to standing-red-only transitions, but the coder's
   new unit test now covers the combined case my bounce identified).
3. **Invariant 3** ("thresholds are read from swarmforge.conf... an
   unowned red throttles at any threshold") — unchanged from the original
   pass, confirmed still correct (`standingRedSignal.test.js` 11/11).

## Verdict

Architecturally compliant. The bounced finding (clearing-branch
misattribution) is resolved and independently confirmed via direct
reproduction and non-vacuity check; no other architecture violation,
invariant violation, or correctness defect found. Forwarding to hardener.
