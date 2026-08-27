# BL-1123 — QA bounce #2 inventory (Article 4.4) — 20260825

- **Ticket**: BL-1123 — guard master checkout against bare and collapsed tip
- **Parcel**: `00_20260825T103639Z_000595_from_documenter_to_QA_for_QA`
  (documenter tip `63095c6517`)
- **Prior bounce**: `83f8fb47d8` (hitchhike → coder)
- **Verified at**: tip `63095c6517` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Cleaner rematch `527fdcc53` is **stacked on prior contaminated tips**
(BL-1118/534/695/1120 still in `origin/main...tip`).

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...63095c6517 | wc -l`
- **Commit tested**: `63095c6517`
- **First error excerpt**:
  ```
  paths=275  non-BL-1123≈255
  cleaner: "stacked hitchhike-free on prior tip"
  ```
- **Expected vs observed**: bare `origin/main` rematch, BL-1123-only;
  observed stacked tip still ~275 paths.

**Remediation pointer**: recreate on current `origin/main` **only** — do not
stack onto sibling rematch tips. Verify path count before re-forward.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
