# BL-1136 hardener pass (rematch #3 / tip-pure rebuild) — 20260825

**QA bounce tip:** `22428e3ed4` (D1: hardener re-dirtied tip-pure rematch2)
**Architect tip kept:** `82d184ee1d` (cleaner `ea6b6f3f26` / coder `c054e0c9aa`)
**Task:** `BL-1136-swarm-stamp-babysitterd-cursor-forge-fbf6f1a909`

## D1 remediation (blame: hardender)

`git reset --hard origin/main` → ff-only tip-pure architect `82d184ee1d` →
stage bounce evidence alone. Confirmed `dels_on_origin=0`. Stamp blobs still
match hotfix `fbf6f1a909`.

## Tip purity

`origin/main...HEAD` → **≈15 paths**, **dels=0**.

## Gates

| Gate | Result |
|------|--------|
| property bl1136 | 3/3 |
| APS BL-1136 | 3/3 |
| Surgical (6, APS+property) | killed=6 survived=0 skipped=0 |

Note: tip-pure stamp tip does not include `test_babysitterd_heartbeat_pulses.sh`;
surgical uses parcel APS + property lanes only.

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1136 only.
Ledger stays awaiting-human.

By hardender.
