# BL-780 — coder rematch3 (tip purity) — 20260827

## Bounce

QA rematch2 `c0823b549d`: architect tip `84c4f12ac2` entangled after folding
coder tip-pure `74de51055` into polluted architect ancestry (BL-506).

Coder tip `74de51055` / `e0e02daa34` was tip-pure vs `origin/main` (verified:
merge + `git diff --name-only origin/main` BL-780-only). Pollution was at
architect forward, not the coder tree.

## Remediation

Single-parent tip on current `origin/main` (no `-s ours` of product tips).
Prior tips listed under `abandoned_commits:`. Architect must tip-pure-merge
(checkout BL-780 paths only) — do not fold into a polluted role branch.

By coder.
