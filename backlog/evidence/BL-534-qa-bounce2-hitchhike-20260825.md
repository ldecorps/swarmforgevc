# BL-534 — QA bounce #2 inventory (Article 4.4) — 20260825

- **Ticket**: BL-534 — thin-main CRAP-visible CLI gate
- **Parcel**: `00_20260825T101418Z_000587_from_documenter_to_QA_for_QA`
  (documenter tip `d6068ba8b9`)
- **Prior bounce**: `2418f52f4e` (D1 incomplete `abandoned_commits` → documenter)
- **Verified at**: tip `d6068ba8b9` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Prior D1 (`abandoned_commits`) appears addressed on the paused YAML at this
tip (five prior SHAs + bounce reverts listed). Landing is still blocked.

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...d6068ba8b9 | wc -l`
- **Commit tested**: `d6068ba8b9`
- **First error excerpt**:
  ```
  paths=234  non-BL-534 paths≈218
  includes BL-1120/BL-695 actives, mass done/ moves, intakes — same
  contamination class as BL-1120/BL-695 bounces this turn.
  ```
- **Expected vs observed**: hitchhike-free rematch on current `origin/main`
  carrying only BL-534 product + docs + abandoned_commits YAML; observed
  234-path tip.

**Remediation pointer**: rematch on `origin/main` (`be3a93e47e`+), keep
BL-534 paths only (including the completed `abandoned_commits` list from
`d6068ba8b9`'s YAML), re-run
`./swarmforge/scripts/pre_qa_gate.sh BL-534-thin-main-crap-visible-cli-gate <tip>`
→ `OK`, then re-forward remaining chain.

## Gates not run

Compile/unit/acceptance/pre_qa on a merged tip — **BLOCKED BY D1**.

By QA.
