# BL-1133 QA bounce rematch2 — 20260825

**Reviewed tip:** documenter `019d93df9e` (merged as `995831b3f5` on swarmforge-QA)
**Task:** `BL-1133-babysitterd-heartbeat-start-and-end-of-tick`
**Sibling:** `VERIFY BL-1133`

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `test_babysitterd_heartbeat_pulses.sh` | ALL PASS (01–06) |
| `test:properties` bl1133 invariants | 4/4 |
| APS BL-1133 feature | 4/4 |
| `test_babysitterd_lifecycle.sh` | ALL PASS |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: hardener)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `019d93df9e`

**First error excerpt:**
```
coder tip 512eb4c7a:     paths=16 dels_on_origin=0  (HAS BL-626-qa-pass)
rebuild tip 5ba6ee73a:   paths=18 dels_on_origin=0
architect tip ed7b8ffbc: paths=19 dels_on_origin=0  (HAS BL-626-qa-pass)
hardener merge 2cbb633f9 ("Merge commit 'ed7b8ffbce' into swarmforge-hardender"):
  paths=296 dels_on_origin=15 (DROPS BL-626)
hardener pass 2381663fe: paths=297 dels=15
documenter tip 019d93df9e: paths=308 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Rematch2 rebuild through architect stayed tip-pure
(`ed7b8ffbc`, dels=0). Hardener merge into dirty worktree re-introduced the
hitchhike that deletes landed BL-626 evidence + `bl626_acceptance_executable_property_runner.bb`
(same class as prior cleaner re-dirties on rematch1; stage owner this round is hardener).

**Remediation:** Rebuild from `origin/main`, merge **only** tip-pure architect
`ed7b8ffbc` (or coder `512eb4c7a` / rebuild `5ba6ee73a`), confirm
`dels_on_origin=0` before surgical pass / forward. Do not merge into a dirty
swarmforge-hardender tip that already carries `39ec97e30` deletions.

**Owner:** `hardener`

## Forward

`git_handoff` to `hardener`, priority `00`.

By QA.
