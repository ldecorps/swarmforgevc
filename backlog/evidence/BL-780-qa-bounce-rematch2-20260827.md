# BL-780 QA bounce — 20260827 (rematch 2)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff 84c4f12ac2
git diff --name-only origin/main
# 152 paths — BL-1166/1167/781/1185/602/… hitchhikers
```

## Commit tested

`84c4f12ac2` (architect handoff; claims tip-pure rematch2). Merge onto
`origin/main` (`7c15ad7c8c`+) succeeds or stages, but the resulting tree is
not tip-pure.

## First error excerpt

Post-merge tree vs `origin/main` includes unrelated product:

- **BL-1166** operatorDocsCore/Html + bridge routes + acceptance
- **BL-1167** same-model seat routing tests/steps
- **BL-781** live-grep / babysitter retirement (deletes wake-runtime files)
- **BL-1185** work-note missing task header
- **BL-602** handoffLatency; living BL-597/600 sweeps deleted or churned
- Backlog active↔paused/topic churn for many unrelated tickets

Claimed tip-pure rematch `b15ddf55d` / `74de51055` still rides entangled
architect ancestry into the handoff tip.

## Failure class

behavior

## Expected vs observed

**Expected:** BL-780-only tip atop current `origin/main` (note actionability
default below warn, ordering guard, handoffd inversion warn, acceptance,
property) with a clean tip-pure tree.

**Observed:** Architect rematch2 tip still entangled (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-780 atop
current `origin/main` with only BL-780 product + evidence; clean merge and
post-merge `git diff --name-only origin/main` must be BL-780-scoped.

By QA.
