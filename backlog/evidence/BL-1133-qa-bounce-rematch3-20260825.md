# BL-1133 QA bounce rematch3 — 20260825

**Reviewed tip:** documenter `e1b3fa77f7` (merged as `1845fe8e91` on swarmforge-QA)
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

### D1 — `behavior` (blame: documenter)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `e1b3fa77f7`

**First error excerpt:**
```
hardener tip ab9bd329e: paths=21 dels_on_origin=0  (HAS BL-626-qa-pass)
documenter merge be3419c28 ("Merge commit 'ab9bd329e3' into swarmforge-documenter"):
  parents include dirty tip 5b5af9787b
  paths=330 dels_on_origin=15 (DROPS BL-626)
documenter tip e1b3fa77f7: paths=331 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Hardender rematch3 rebuilt tip-pure (`ab9bd329e`,
dels=0). Documenter merge into dirty worktree re-introduced hitchhike deletes
of landed BL-626 evidence + `bl626_acceptance_executable_property_runner.bb`.

**Remediation:** Reset documenter to `origin/main`, merge **only** tip-pure
hardender `ab9bd329e`, confirm `dels_on_origin=0` before Spec stamp / forward.

**Owner:** `documenter`

## Forward

`git_handoff` to `documenter`, priority `00`.

By QA.
