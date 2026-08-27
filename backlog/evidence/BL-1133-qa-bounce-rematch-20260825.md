# BL-1133 QA bounce (rematch) — 20260825

**Reviewed tip:** documenter `a286855bba` (merged as `4478032bff` on swarmforge-QA)
**Task:** `BL-1133-babysitterd-heartbeat-start-and-end-of-tick`
**Sibling:** `VERIFY BL-1133`
**Prior bounce:** `BL-1133-qa-bounce-20260825.md` (D1 hitchhike → coder)

## Parcel-owned gates (run-or-blocked)

| Gate | Result |
|------|--------|
| `test_babysitterd_heartbeat_pulses.sh` | ALL PASS (01–06) |
| `test:properties` bl1133 invariants | 4/4 |
| APS BL-1133 feature | 4/4 |
| Tip purity / dropped-work vs `origin/main` | **FAIL → D1** |

## Inventory

### D1 — `behavior` (blame: cleaner)

**Failing command:**
`comm` of deletions vs files on `origin/main` for documenter tip → **15**;
same for cleaner tip `6e0831bfb` → **15**. Coder rematch tip
`512eb4c7a` → **0** deletes / **16** paths.

**Commit hash checked:** `a286855bba` (documenter rematch tip)

**First error excerpt:**
```
coder rematch 512eb4c7a: paths=16 dels_on_origin=0  (HAS BL-626-qa-pass)
cleaner tip    6e0831bfb: paths=263 dels_on_origin=15 (DROPS BL-626 evidence)
architect/hardener/documenter tips after that: same 15 deletes
deleted vs origin/main includes:
backlog/evidence/BL-626-*-20260825.md
swarmforge/scripts/test/bl626_acceptance_executable_property_runner.bb
```

**Failure class:** `behavior`

**Expected vs observed:** After QA's first bounce, coder re-cut a tip-pure
commit (`512eb4c7a`). Expected stages to forward **that** purity. Observed
cleaner tip `6e0831bfb` (and every later stage tip) re-introduce the hitchhike
by merging the pure tip into a dirty worktree — landing would again delete
landed BL-626 evidence (BL-506; BL-571/958). Architect's rematch evidence
asserted purity against `origin/main...512eb4c7ae` (coder tip) but forwarded
a dirty tip.

**Remediation:** On cleaner: reset/rebuild from `origin/main`, merge **only**
`512eb4c7a` (or equivalent tip-pure content), keep BL-1133 paths only, confirm
`dels_on_origin=0` before forwarding. Do not merge into a branch that still
carries the pre-rematch hitchhike.

**Owner:** `cleaner` (earliest stage that turned the tip-pure coder rematch
dirty again)

## Forward

`git_handoff` to `cleaner`, priority `00`.
QA clears the receive merge from `swarmforge-QA` (BL-490).

By QA.
