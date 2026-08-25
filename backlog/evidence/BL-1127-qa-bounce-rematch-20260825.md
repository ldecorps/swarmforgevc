# BL-1127 QA bounce rematch — 20260825

**Reviewed tip:** documenter `de10fe1c01` (merged as `cc8b02bd9f` on swarmforge-QA)
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

### D1 — `behavior` (blame: hardender)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `de10fe1c01`

**First error excerpt:**
```
coder tip 15af12d36:     paths=15 dels_on_origin=0
rebuild tip c8e429c1e:   paths=17 dels_on_origin=0
architect tip 59d122237: paths=18 dels_on_origin=0  (HAS BL-626-qa-pass)
hardender merge 0b96fe5ac ("Merge commit '59d122237b' into swarmforge-hardender"):
  paths=304+ dels_on_origin=15 (DROPS BL-626)
hardender pass a0428730e: paths=305 dels=15
documenter tip de10fe1c01: paths=318 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Tip-pure rebuild through architect (`59d122237`,
dels=0). Hardender merge into dirty worktree re-introduced hitchhike deletes
of landed BL-626 evidence + `bl626_acceptance_executable_property_runner.bb`.

**Remediation:** Reset hardender to `origin/main`, merge **only** tip-pure
architect `59d122237` (or coder `15af12d36` / rebuild `c8e429c1e`), confirm
`dels_on_origin=0` before surgical pass / forward.

**Owner:** `hardender`

## Forward

`git_handoff` to `hardender`, priority `00`.

By QA.
