# BL-1135 QA bounce rematch3 — 20260825

**Reviewed tip:** documenter `9ab1d195e6` (merged as `a70cf1e8ee` on swarmforge-QA)
**Task:** `BL-1135-bl1131-residual-live-land-no-operator-absorb`
**Sibling:** `VERIFY BL-1135`

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `master_main_reconcile_lib_test_runner.bb` | ALL PASS |
| `test:properties` bl1135 invariants | 4/4 |
| APS BL-1135 feature | 4/4 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: documenter)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `9ab1d195e6`

**First error excerpt:**
```
hardener tip 7fcdd1c91: paths=19 dels_on_origin=0  (HAS BL-626-qa-pass)
documenter merge 8e0c9cbd9 ("Merge … into swarmforge-documenter"):
  paths=334- dels_on_origin=15 (DROPS BL-626)
documenter tip 9ab1d195e6: paths=334 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Hardender rematch3 rebuilt tip-pure (`7fcdd1c91`,
dels=0). Documenter merge into dirty worktree re-introduced hitchhike deletes
of landed BL-626 evidence + property runner.

**Remediation:** Reset documenter to `origin/main`, merge **only** tip-pure
hardender `7fcdd1c91`, confirm `dels_on_origin=0` before Spec stamp / forward.

**Owner:** `documenter`

## Forward

`git_handoff` to `documenter`, priority `00`.

By QA.
