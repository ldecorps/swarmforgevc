# BL-780 QA bounce — 20260827 (rematch)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff 823576ac63
# CONFLICT architecture.mmd, docs/index.md, Specification.MD, steps/index.js
git diff --name-only origin/main   # during conflicted merge
# 129 paths — BL-1166/605/781/1185/597/… hitchhikers
```

## Commit tested

`823576ac63` (architect handoff; claims tip-pure rematch after prior QA bounce).
Merge onto `origin/main` (`01cc6cc62e`, post-BL-601) conflicts; staging/tree
carries mass hitchhikers.

## First error excerpt

Post-merge working tree vs `origin/main` includes unrelated product:

- **BL-1166** operatorDocsCore/Html + bridge routes + acceptance steps
- **BL-605** globalTokenConsumption + tests/steps
- **BL-781** live-grep offender + babysitter retirement scripts
- **BL-1185** work-note missing task header feature/steps
- **BL-600/602** humanDecisionLatency / handoffLatency modules
- Spec/index/arch conflicts; deletes/reverts living BL-597 docs/sweeps

Claimed tip-pure rematch commit `8fd94aece` itself is only evidence + one
`index.js` require line; the handoff tip ancestry still is not tip-pure.

## Failure class

behavior

## Expected vs observed

**Expected:** BL-780-only tip atop current `origin/main` (note actionability
default below warn, ordering guard, handoffd inversion warn, acceptance,
property runner) with a clean merge.

**Observed:** Architect tip still entangled; merge conflicts (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-780 atop
current `origin/main` (`01cc6cc62e`+) with only BL-780 product + evidence;
clean merge required. Do not re-carry BL-1166/605/781/1185/600/602.

By QA.
