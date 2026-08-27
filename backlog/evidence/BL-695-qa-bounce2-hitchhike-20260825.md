# BL-695 — QA bounce #2 inventory (Article 4.4) — 20260825

- **Ticket**: BL-695 — supervisor threads are not front-desk topics
- **Parcel**: `00_20260825T102943Z_000591_from_documenter_to_QA_for_QA`
  (documenter tip `c405204eff`)
- **Prior bounce**: `15e394c8f9` (hitchhike → coder)
- **Verified at**: tip `c405204eff` vs `origin/main` (no merge — hitchhike)
- **Reviewed by**: QA, 2026-08-25

## Verdict

**BOUNCE — inventory items: D1 (one item).**

Cleaner rematch `5018de281` / `77d1f09ad` claims hitchhike-free but was
**stacked on the contaminated BL-1120 tip** (`c531927e6` lineage still
carrying BL-1118/1123/534/…), so `origin/main...tip` remains huge.

## Inventory

### D1 — tip hitchhikes foreign work onto `origin/main`

- **Failure class**: `behavior`
- **Blamed role**: `coder`
- **Failing command**:
  `git diff --name-only origin/main...c405204eff | wc -l`
- **Commit tested**: `c405204eff`
- **First error excerpt**:
  ```
  paths=262  non-BL-695≈245
  merge parents include 53c8d5011 (BL-1120 abandoned tip we just bounced #2)
  ```
- **Expected vs observed**: rematch on bare `origin/main` with only BL-695
  paths; observed stacked rematch still ~262 paths vs main.

**Remediation pointer**: recreate on current `origin/main` **only** — do not
stack onto sibling rematch tips. Verify
`git diff --name-only origin/main...HEAD` is BL-695-only before re-forward.

## Gates not run

All product gates **BLOCKED BY D1**.

By QA.
