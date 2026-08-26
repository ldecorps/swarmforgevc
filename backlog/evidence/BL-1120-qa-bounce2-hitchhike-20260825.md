# BL-1120 — QA bounce #2 inventory (Article 4.4) — 20260825

- **Ticket**: BL-1120 — handoffd must not abort a foreign master-main merge
- **Parcel**: `00_20260825T102534Z_000590_from_documenter_to_QA_for_QA`
  (documenter tip `53c8d50110`)
- **Prior bounce**: `50e12eab7c` (hitchhike → coder)
- **Verified at**: tip `53c8d50110` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Documenter listed prior bounce tip under `abandoned_commits`, but the
forwarded tip is still contaminated: cleaner rematch `c531927e6` /
`5c24f8146` was later merged with BL-1118/1123/534/695 lineages.

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...53c8d50110 | wc -l`
- **Commit tested**: `53c8d50110`
- **First error excerpt**:
  ```
  paths=258
  ancestry still carries BL-1123/1118/534/695 merges after the rematch
  (e.g. d91840d50, b5c59dfd2, d6068ba8b, 3462ee56b).
  ```
- **Expected vs observed**: tip whose `origin/main...HEAD` is BL-1120-only;
  observed 258-path delta again.

**Remediation pointer**: recreate on current `origin/main` only — cherry-pick
BL-1120 product (`5c24f8146` / hardener rematch `52dc469c2` / docs) without
merging sibling ticket tips. Re-verify path count before re-forward.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
