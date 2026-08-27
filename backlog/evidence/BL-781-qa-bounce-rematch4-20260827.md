# BL-781 QA bounce — 20260827 (rematch 4)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff 9da97fcb29
# CONFLICT specs/pipeline/steps/index.js
git diff --name-only origin/main   # during conflicted merge
# 123 paths — BL-1166/605/780/1185/597/… hitchhikers
```

## Commit tested

`9da97fcb29` (architect handoff; claims tip-pure rematch 4). Merge onto
`origin/main` (`b79af43266`, post-BL-600) conflicts; tree carries mass
hitchhikers.

## First error excerpt

Post-merge working tree vs `origin/main` includes unrelated product:

- **BL-1166** operatorDocsCore/Html + bridge routes
- **BL-605** globalTokenConsumption + tests/steps
- **BL-780** note actionability steps/conf/property runner
- **BL-1185** work-note missing task header
- **BL-602** handoffLatency; Spec/index/arch churn; living BL-597 docs wipe risk

## Failure class

behavior

## Expected vs observed

**Expected:** BL-781-only tip atop current `origin/main` (wake-runtime
retirement + live-grep filter + acceptance) with a clean merge.

**Observed:** Architect tip still entangled after rematch 4 (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-781 atop
current `origin/main` (`b79af43266`+) with only BL-781 product + evidence;
clean merge required.

By QA.
