# BL-1132 QA bounce rematch2 — 20260825

**Reviewed tip:** documenter `20e9a723f0` (merged as `9082771e3f` on swarmforge-QA)
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

### D1 — `behavior` (blame: hardender)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `20e9a723f0`

**First error excerpt:**
```
coder tip bca6102de:     paths=14 dels_on_origin=0
rebuild tip db9a4d6a4:   paths=16 dels_on_origin=0
architect tip 56173b6f2: paths=17 dels_on_origin=0  (HAS BL-626-qa-pass)
hardender merge 26a55d81b ("Merge … into swarmforge-hardender"):
  paths=308 dels_on_origin=15 (DROPS BL-626)
hardender pass e9cf6cc4a: paths=309 dels=15
documenter tip 20e9a723f0: paths=323 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Rematch2 rebuild through architect stayed tip-pure
(`56173b6f2`, dels=0). Hardender merge into dirty worktree re-introduced
hitchhike deletes of landed BL-626 evidence + property runner.

**Remediation:** Reset hardender to `origin/main`, merge **only** tip-pure
architect `56173b6f2` (or coder `bca6102de` / rebuild `db9a4d6a4`), confirm
`dels_on_origin=0` before surgical pass / forward.

**Owner:** `hardender`

## Forward

`git_handoff` to `hardender`, priority `00`.

By QA.
