# BL-781 QA bounce — 20260827 (rematch)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git fetch origin main
git reset --hard origin/main
git merge --no-ff 65f50e2fd4
git diff --name-only origin/main...HEAD
# 36 paths — BL-601 / BL-780 product hitchhikers
```

## Commit tested

`65f50e2fd4` (architect handoff; claims tip-pure rematch). Merge onto
`origin/main` (`76128c853`) succeeded; post-merge tree is not tip-pure.

## First error excerpt

Post-merge delta vs `origin/main` includes unrelated product:

- **BL-601** `compactionCadence.ts` / store / tests / steps / trend export
- **BL-780** note-actionability steps + ordering script + conf / mono_router
- Plus evidence noise for BL-601/780/596/1169/738

BL-781 retirement deletes (`babysitter_assess.bb`, `babysitter_lib.bb`, …) are
present but not isolated.

## Failure class

behavior

## Expected vs observed

**Expected:** BL-781-only tip (retire dead wake-runtime files + live-grep
filter fix for scen07 + acceptance + evidence).

**Observed:** Architect tip folds BL-601/BL-780 into a BL-781 handoff (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Re-forward tip-pure BL-781 atop
current `origin/main` without BL-601/BL-780 hitchhikers. Keep prior D1
live-grep filter fix (exclude `specs/features/` and `extension/test` as needed
so acceptance scen07 does not self-flag).

By QA.
