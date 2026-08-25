# BL-1136 QA bounce rematch2 — 20260825

**Reviewed tip:** documenter `5b5af9787b` (merged as `046a5c306e` on swarmforge-QA)
**Task:** `BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909`
**Sibling:** `VERIFY BL-1136`

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `test:properties` bl1136 stamp-off | 3/3 |
| APS BL-1136 feature | 3/3 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: hardender)

**Failing command:** tip purity vs `origin/main`.

**Commit hash checked:** `5b5af9787b`

**First error excerpt:**
```
coder tip c054e0c9a:     paths=11 dels_on_origin=0
rebuild tip ea6b6f3f2:   paths=13 dels_on_origin=0
architect tip 82d184ee1: paths=14 dels_on_origin=0  (HAS BL-626-qa-pass)
hardender merge into swarmforge-hardender (parents dirty tip + 82d184ee1):
  dels_on_origin=15 (DROPS BL-626)
hardender pass ab7ceea8e: paths=313 dels=15
documenter tip 5b5af9787b: paths=328 dels=15
```

**Failure class:** `behavior`

**Expected vs observed:** Rematch2 stamp rebuild through architect stayed
tip-pure (`82d184ee1`, dels=0). Hardender merge into dirty worktree
re-introduced hitchhike deletes of landed BL-626 evidence + property runner.

**Remediation:** Reset hardender to `origin/main`, merge **only** tip-pure
architect `82d184ee1` (or coder `c054e0c9a` / rebuild `ea6b6f3f2`), confirm
`dels_on_origin=0` before surgical pass / forward.

**Owner:** `hardender`

## Forward

`git_handoff` to `hardender`, priority `00`.

By QA.
