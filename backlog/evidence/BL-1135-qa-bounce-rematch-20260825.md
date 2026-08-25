# BL-1135 QA bounce (rematch) — 20260825

**Reviewed tip:** documenter `8402c08f23` (merged as `b2e908be8b` on swarmforge-QA)
**Task:** `BL-1135-bl1131-residual-live-land-no-operator-absorb`
**Sibling:** `VERIFY BL-1135`
**Prior bounce:** `BL-1135-qa-bounce-20260825.md` (D1 hitchhike → coder)

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `master_main_reconcile_lib_test_runner.bb` | ALL TESTS PASS |
| `test:properties` bl1135 invariants | 4/4 |
| APS BL-1135 feature | 4/4 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: cleaner)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `8402c08f23`

**First error excerpt:**
```
coder rematch dd7be8260: paths=14 dels_on_origin=0  (HAS BL-626-qa-pass)
cleaner merge d7e02299f / tip 399aeb184: paths=273+ dels=15 (DROPS BL-626)
documenter tip 8402c08f23: paths=282 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Coder re-cut tip-pure `dd7be8260`. Cleaner merged
it into a dirty worktree (`d7e02299f`), re-introducing the hitchhike that
deletes landed BL-626 evidence. Same class as BL-1133 rematch bounce to
cleaner.

**Remediation:** Rebuild from `origin/main`, merge **only** `dd7be8260`,
confirm `dels_on_origin=0` before forward.

**Owner:** `cleaner`

## Forward

`git_handoff` to `cleaner`, priority `00`.

By QA.
