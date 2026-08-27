# BL-781 QA bounce — 20260827 (rematch 2)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git fetch origin main
git reset --hard origin/main
git merge --no-ff 9276c08354
# CONFLICT trend.ts, index.js, handoff_lib.bb, suite-manifest.tsv
# CONFLICT (modify/delete): bl599TrendIntakeBalanceSteps.js
```

## Commit tested

`9276c08354` (architect handoff). Merge onto `origin/main` (`12e961bb3`,
post-BL-605 land) fails with conflicts; three-dot tip also carries
non-BL-781 surfaces.

## First error excerpt

```
CONFLICT (content): Merge conflict in extension/src/metrics/trend.ts
CONFLICT (modify/delete): specs/pipeline/steps/bl599TrendIntakeBalanceSteps.js
  deleted in HEAD and modified in 9276c08354
CONFLICT (content): Merge conflict in specs/pipeline/steps/index.js
CONFLICT (content): Merge conflict in swarmforge/scripts/handoff_lib.bb
CONFLICT (content): Merge conflict in swarmforge/scripts/test/suite-manifest.tsv
```

## Failure class

behavior

## Expected vs observed

**Expected:** BL-781-only tip (retire dead wake-runtime + live-grep filter +
acceptance) merging cleanly onto current `origin/main`.

**Observed:** Architect tip still entangled (BL-599 steps resurface; trend /
handoff / suite-manifest conflicts) — BL-506.

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-781 atop
current `origin/main` (after BL-605 land `12e961bb3`) with zero hitchhikers
and a clean merge.

By QA.
