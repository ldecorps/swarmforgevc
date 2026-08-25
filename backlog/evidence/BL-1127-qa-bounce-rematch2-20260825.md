# BL-1127 QA bounce rematch2 — 20260825

**Reviewed tip:** documenter `b3a810aa9f` (merged as `9ba7a18b36` on swarmforge-QA)
**Task:** `BL-1127-local-coder-steward-evidence-bar`
**Sibling:** `VERIFY BL-1127`

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `test_local_coder_battery.sh` | ALL PASS (01–08) |
| `model_steward_test_runner.bb` | ALL PASS |
| APS BL-1127 feature | 3/3 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: documenter)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `b3a810aa9f`

**First error excerpt:**
```
hardener tip 19ae86502: paths=20 dels_on_origin=0  (HAS BL-626-qa-pass)
documenter merge e9d03fa60 ("Merge commit '19ae86502d' into swarmforge-documenter"):
  paths=337- dels_on_origin=15 (DROPS BL-626)
documenter tip b3a810aa9f: paths=337 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Hardender rematch2 rebuilt tip-pure (`19ae86502`,
dels=0). Documenter merge into dirty worktree re-introduced hitchhike deletes
of landed BL-626 evidence + property runner.

**Remediation:** Reset documenter to `origin/main`, merge **only** tip-pure
hardender `19ae86502`, confirm `dels_on_origin=0` before Spec stamp / forward.

**Owner:** `documenter`

## Forward

`git_handoff` to `documenter`, priority `00`.

By QA.
