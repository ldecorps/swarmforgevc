# BL-605 QA bounce — 20260827 (rematch)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff 2dc737529d
git diff --name-only origin/main...HEAD
# 31 paths — BL-597 / BL-599 / BL-602 / BL-780 hitchhikers
```

## Commit tested

`2dc737529d` (coder handoff; Vitest rematch + wiring markers). Merge onto
`origin/main` (`c7d329b46`) succeeded; post-merge tree is not tip-pure.

## First error excerpt

Post-merge delta includes unrelated product:

- **BL-597** selfHealTelemetry + steps + bb lib/cli
- **BL-599** intake-balance property + steps
- **BL-602** handoffLatency + steps + handoff emit hooks
- **BL-780** rotation actionability ordering script

## Failure class

behavior

## Expected vs observed

**Expected:** BL-605-only tip (globalTokenConsumption + trend export + Vitest
unit suite + acceptance + evidence).

**Observed:** Coder tip folds BL-597/599/602/780 into a BL-605 handoff (BL-506).

## Defects

**D1 — entangled tip (blame: coder):** Re-forward tip-pure BL-605 atop current
`origin/main` without sibling trend/self-heal/BL-780 hitchhikers. Keep prior
Vitest registration fix for `globalTokenConsumption.test.js`.

By QA.
