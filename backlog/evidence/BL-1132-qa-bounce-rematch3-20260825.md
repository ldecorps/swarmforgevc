# BL-1132 QA bounce rematch3 — 20260825

**Reviewed tip:** documenter `e7aac3e3b0` (merged as `3ab97dc790` on swarmforge-QA)
**Task:** `BL-1132-headroom-raise-telemetry-path-and-coordinator-duty`
**Sibling:** `VERIFY BL-1132`

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `headroom_cap_raise_lib_test_runner.bb` | ALL PASS |
| `test:properties` bl1132 invariants | 3/3 |
| APS BL-1132 feature | 3/3 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: documenter)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `e7aac3e3b0`

**First error excerpt:**
```
hardener tip 0dd808abf: paths=19 dels_on_origin=0  (HAS BL-626-qa-pass)
documenter merge d050bbda2 ("Merge commit '0dd808abfb' into swarmforge-documenter"):
  paths=340- dels_on_origin=15 (DROPS BL-626)
documenter tip e7aac3e3b0: paths=340 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Hardender rematch3 rebuilt tip-pure (`0dd808abf`,
dels=0). Documenter merge into dirty worktree re-introduced hitchhike deletes
of landed BL-626 evidence + property runner.

**Remediation:** Reset documenter to `origin/main`, merge **only** tip-pure
hardender `0dd808abf`, confirm `dels_on_origin=0` before Spec stamp / forward.

**Owner:** `documenter`

## Forward

`git_handoff` to `documenter`, priority `00`.

By QA.
