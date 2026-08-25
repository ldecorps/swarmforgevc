# BL-1118 — QA bounce #2 inventory (Article 4.4) — 20260825

- **Ticket**: BL-1118 — post-cursor batch merge origin/main
- **Parcel**: `00_20260825T103513Z_000594_from_documenter_to_QA_for_QA`
  (documenter tip `df8ccd5299`)
- **Prior bounce**: `f9e696ba5f` (hitchhike → coder)
- **Verified at**: tip `df8ccd5299` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Cleaner rematch `b3f8070df` / `b3e850a08` is **stacked on prior contaminated
tips** (BL-534/695/1120 lineages still in `origin/main...tip`).

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...df8ccd5299 | wc -l`
- **Commit tested**: `df8ccd5299`
- **First error excerpt**:
  ```
  paths=271  non-BL-1118≈254
  cleaner: "stacked hitchhike-free on prior tip"
  ```
- **Expected vs observed**: bare `origin/main` rematch, BL-1118-only paths;
  observed stacked tip still ~271 paths.

**Remediation pointer**: recreate on current `origin/main` **only** — do not
stack onto sibling rematch tips. Verify path count before re-forward.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
