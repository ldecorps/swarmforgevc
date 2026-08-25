# BL-1124 — QA bounce inventory (Article 4.4) — 20260825

- **Ticket**: BL-1124 — property-suite fixtures must not mutate shared main
- **Parcel**: `00_20260825T103913Z_000597_from_documenter_to_QA_for_QA`
  (documenter tip `44c9dd640e`)
- **Verified at**: tip `44c9dd640e` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Same contamination class as today's BL-1120/1123/1118/534/695 bounces:
cleaner/hardener "hitchhike-free rematch" was stacked onto sibling rematch
tips, so `origin/main...tip` still carries foreign actives, done/, extension,
and other tickets' product.

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...44c9dd640e | wc -l`
- **Commit tested**: `44c9dd640e`
- **First error excerpt**:
  ```
  paths=290  non-BL-1124≈283
  ancestry merges BL-1120/1123/1118/534/695 rematches
  (e.g. 9b12f73b1, c619b9b66, 0d971b1cb, fa8425fe9, 88424943a).
  ```
- **Expected vs observed**: tip whose `origin/main...HEAD` is BL-1124-only
  (guard scripts, APS, how-to, ticket YAML/evidence); observed 290-path delta.

**Remediation pointer**: recreate on current `origin/main` only — cherry-pick
BL-1124 product (`2995c3c83` / cleaner `404b9fbc3` / hardener `cf6c3ce79` /
docs) without merging sibling ticket tips. Re-verify path count before
re-forwarding the remaining chain.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
