# BL-781 QA bounce — 20260827 (rematch 3)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff efbc2d8558
# CONFLICT architecture.mmd, docs/index.md, Specification.MD
git diff --cached --name-only | wc -l
# 121 paths — BL-601/602/605/780/1185/… hitchhikers
```

## Commit tested

`efbc2d8558` (architect handoff). Merge onto `origin/main` (`460fe8597`)
conflicts; staging includes mass hitchhikers.

## First error excerpt

Staged delta includes unrelated product: compactionCadence, handoffLatency,
globalTokenConsumption, BL-780 steps/conf, BL-1185, reverts done→active for
BL-1163/1169, deletes BL-597 docs/sweeps, etc.

## Failure class

behavior

## Expected vs observed

**Expected:** BL-781-only tip merging cleanly onto current `origin/main`.

**Observed:** Architect tip still not tip-pure (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-781 atop
current `origin/main` (`460fe8597`+) with only wake-runtime retirement +
live-grep filter + acceptance; clean merge required.

By QA.
