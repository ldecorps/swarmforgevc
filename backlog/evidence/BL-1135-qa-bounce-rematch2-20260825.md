# BL-1135 QA bounce rematch2 — 20260825

**Reviewed tip:** documenter `2be9126d60` (merged as `b9eda42c38` on swarmforge-QA)
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

### D1 — `behavior` (blame: hardender)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `2be9126d60`

**First error excerpt:**
```
coder tip dd7be8260:     paths=14 dels_on_origin=0
rebuild tip f467ddb36:   paths=16 dels_on_origin=0
architect tip 463067f25: paths=17 dels_on_origin=0  (HAS BL-626-qa-pass)
hardender merge 690f6585b ("Merge commit '463067f25a' into swarmforge-hardender"):
  paths=300 dels_on_origin=15 (DROPS BL-626; parent includes dirty 2381663fe)
hardender pass 25f02d70e: paths=301 dels=15
documenter tip 2be9126d60: paths=313 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Rematch2 rebuild through architect stayed tip-pure
(`463067f25`, dels=0). Hardender merge into dirty worktree (still carrying
BL-1133 hitchhike parent `2381663fe`) re-introduced deletes of landed BL-626
evidence + `bl626_acceptance_executable_property_runner.bb`.

**Remediation:** Reset hardender to `origin/main`, merge **only** tip-pure
architect `463067f25` (or coder `dd7be8260` / rebuild `f467ddb36`), confirm
`dels_on_origin=0` before surgical pass / forward.

**Owner:** `hardender`

## Forward

`git_handoff` to `hardender`, priority `00`.

By QA.
