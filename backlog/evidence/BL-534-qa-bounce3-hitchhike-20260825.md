# BL-534 — QA bounce #3 inventory (Article 4.4) — 20260825

- **Ticket**: BL-534 — thin-main CRAP-visible CLI gate
- **Parcel**: `00_20260825T103332Z_000593_from_documenter_to_QA_for_QA`
  (documenter tip `52b9a7b44b`)
- **Prior bounces**: `2418f52f4e` (abandoned_commits → documenter);
  `3c9b6ceb67` (hitchhike → coder)
- **Verified at**: tip `52b9a7b44b` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Cleaner rematch `21ba7fbc2` / `89110db6d` is again **stacked on the
contaminated BL-1120+695 tip**, so path count vs `origin/main` stays huge.

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...52b9a7b44b | wc -l`
- **Commit tested**: `52b9a7b44b`
- **First error excerpt**:
  ```
  paths=267  non-BL-534≈246
  cleaner subject: "stacked hitchhike-free on BL-1120+695 tip"
  ```
- **Expected vs observed**: rematch on bare `origin/main` with only BL-534;
  observed stacked tip still ~267 paths.

**Remediation pointer**: recreate on current `origin/main` **only** — do not
stack onto sibling rematch tips. Path count must be BL-534-only before
re-forward. Keep completed `abandoned_commits` from prior documenter passes.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
