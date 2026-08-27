# BL-780 QA bounce — 20260827 (rematch 3)

**Routing:** coder (tip-pure handoff / branch pollution — BL-506)

## Failing command

```
git merge --no-ff d6e2dfa165
git diff --name-only origin/main
# 173 paths — BL-1166/1167/1175/726/781/1185/602/… hitchhikers
```

## Commit tested

`d6e2dfa165` (architect handoff; claims tip-pure rematch3 / single-parent tip).
Merge onto `origin/main` (`7c15ad7c8c`+) yields a massively entangled tree.

## First error excerpt

Post-merge tree includes unrelated product:

- **BL-1166** operator docs; **BL-1167** same-model seat routing
- **BL-1175** property-suite standing-red allowlist
- **BL-726/718** acceptance step wiring
- **BL-781** live-grep / babysitter retirement (deletes wake-runtime)
- **BL-1185** work-note header; **BL-602** handoffLatency
- Deletes living BL-597 how-to / mutation sweeps

Claimed single-parent rematch `070a82f99` / `0013f00ee` still rides
entangled architect ancestry into the handoff tip.

## Failure class

behavior

## Expected vs observed

**Expected:** BL-780-only tip atop current `origin/main` with clean
post-merge `git diff --name-only origin/main` scoped to BL-780.

**Observed:** Architect rematch3 tip still entangled (BL-506).

## Defects

**D1 — entangled tip (blame: coder rematch):** Rebuild tip-pure BL-780 atop
current `origin/main` from a *single* commit (or short tip-pure chain) whose
tree delta is only note-actionability + ordering guard + acceptance +
evidence. Do not merge-record sibling tips onto the handoff commit.

By QA.
