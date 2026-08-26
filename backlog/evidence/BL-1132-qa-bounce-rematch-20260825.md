# BL-1132 QA bounce (rematch) — 20260825

**Reviewed tip:** documenter `cad2b50dbc` (merged as `21c13188d3` on swarmforge-QA)
**Task:** `BL-1132-headroom-raise-telemetry-path-and-coordinator-duty`
**Sibling:** `VERIFY BL-1132`
**Prior bounce:** `BL-1132-qa-bounce-20260825.md` (D1 hitchhike → coder)

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `headroom_cap_raise_lib_test_runner.bb` | ALL CHECKS PASSED |
| `test:properties` bl1132 invariants | 3/3 |
| APS BL-1132 feature | 3/3 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: cleaner)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `cad2b50dbc`

**First error excerpt:**
```
coder rematch bca6102de: paths=14 dels_on_origin=0  (HAS BL-626-qa-pass)
cleaner merge 867f830dc: paths=284 dels=15 (DROPS BL-626)
documenter tip cad2b50dbc: paths=303 dels=15
(also carries BL-1136 stamp-off paths — multi-ticket hitchhike on BL-1132 parcel)
```

**Failure class:** `behavior`

**Expected vs observed:** Coder re-cut tip-pure `bca6102de`. Cleaner merge
`867f830dc` into dirty worktree re-introduced hitchhike deleting landed
BL-626 evidence (same class as BL-1133/1135/1127 cleaner bounces).

**Remediation:** Rebuild from `origin/main`, merge **only** `bca6102de`,
confirm `dels_on_origin=0` and BL-1132-only paths before forward.

**Owner:** `cleaner`

## Forward

`git_handoff` to `cleaner`, priority `00`.

By QA.
