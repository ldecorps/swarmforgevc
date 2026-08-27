# BL-781 QA bounce — 20260827 (rematch 5)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff b56ca33e92
# CONFLICT backlog/active/BL-780-note-actionability-outruns-watchdog-warn.yaml
git diff --name-only origin/main
# 169 paths — BL-1166/1167/1175/726/780/1185/602/… hitchhikers
```

## Commit tested

`b56ca33e92` (architect handoff; claims tip-pure rematch 5 + conflict-marker
cleanup). Merge onto `origin/main` conflicts; tree carries mass hitchhikers.

## First error excerpt

Post-merge tree vs `origin/main` includes unrelated product:

- **BL-1166** operator docs; **BL-1167** same-model seat routing
- **BL-1175** property-suite standing-red allowlist
- **BL-726** / **BL-718** acceptance step wiring
- **BL-780** note actionability (CONFLICT on ticket YAML)
- **BL-1185** work-note header; **BL-602** handoffLatency
- Living BL-597/600 sweeps and babysitter wake-runtime churn

## Failure class

behavior

## Expected vs observed

**Expected:** BL-781-only tip atop current `origin/main` (wake-runtime
retirement + live-grep filter + acceptance) with a clean merge.

**Observed:** Architect rematch 5 tip still entangled (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-781 atop
current `origin/main` with only BL-781 product + evidence; clean merge and
post-merge `git diff --name-only origin/main` must be BL-781-scoped.

By QA.
