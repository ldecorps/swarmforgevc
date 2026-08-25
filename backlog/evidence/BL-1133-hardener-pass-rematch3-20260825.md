# BL-1133 hardener pass (rematch #3 / tip-pure rebuild) — 20260825

**QA bounce tip:** `8016ddf215` (D1: hardener re-dirtied tip-pure rematch2)
**Architect tip kept:** `ed7b8ffbc` (cleaner `5ba6ee73aa` / coder `512eb4c7ae`)
**Task:** `BL-1133-babysitterd-heartbeat-start-and-end-of-tick`

## D1 remediation (blame: hardener)

Prior rematch2 merged architect into a dirty `swarmforge-hardender` tip
(`dels_on_origin=15`, dropped landed BL-626 evidence). Remediation:

1. `git reset --hard origin/main`
2. Fast-forward **only** tip-pure architect `ed7b8ffbc`
3. Stage QA bounce evidence file alone (do **not** merge dirty QA tip)
4. Confirm `dels_on_origin=0` before surgical / forward

## Tip purity (this tip)

`origin/main...HEAD` → **paths ≈ 20**, **dels=0** (bounce evidence + harden
evidence only beyond architect’s 19).

## Gates

| Gate | Result |
|------|--------|
| `test_babysitterd_heartbeat_pulses.sh` | ALL PASS (01–06) |
| property bl1133 | 4/4 |
| APS BL-1133 feature | 4/4 |
| Soft Gherkin | inapplicable — not a pass |
| Surgical (6, `utc_iso` anchors) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-1133 only.

By hardender.
