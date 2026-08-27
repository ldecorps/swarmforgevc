# BL-780 — coder rematch4 (tip purity) — 20260827

## Bounce

QA rematch3 `9b674ecfb0` / parcel tip `b7eac60793`: architect tip
`d6e2dfa165` entangled after folding coder tip-pure `0013f00ee5` into
polluted architect ancestry via `-s ours` merge-record (BL-506). Post-merge
tree showed ~173 hitchhiker paths (BL-1166/1167/1175/726/781/1185/602/…).

Coder tip `0013f00ee5` was tip-pure vs `origin/main` (verified: merge +
`git diff --name-only origin/main` BL-780-only). Pollution was at architect
forward, not the coder tree.

## Remediation

Single-parent tip on current `origin/main` (no `-s ours` of product tips).
Prior tips listed under `abandoned_commits:`.

**Architect MUST tip-pure-merge:** checkout the named BL-780 paths only onto
a clean `origin/main` worktree. Do **not** merge-record this tip onto a
polluted role branch; do **not** `-s ours` fold sibling tips into the handoff
commit. A merge that widens `git diff --name-only origin/main` beyond BL-780
will bounce again.

By coder.
