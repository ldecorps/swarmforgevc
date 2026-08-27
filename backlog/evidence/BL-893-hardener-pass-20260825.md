# BL-893 hardener pass — 20260825

**Cleaner tip:** `48eae4ff42` (architect skipped — wires existing ambulance engage)
**Task:** `BL-893-approvals-ambulance-choice`

## Tip purity

`git reset --hard origin/main` → merge tip-pure cleaner.
`origin/main...HEAD` → **13 paths**, **0 deletes** (pre-evidence).

## Product surface

Approvals Ambulance button + `/ambulance` verb engage Control hold only
via shared `engageApprovalsAmbulanceHold`; never approve / Q-jump /
expedite. Authorize **BL-893 paths only**.

## Hardener deltas

Unit: unwired `engageApprovalsAmbulance` posts "not wired" and drops.

## Gates

| Gate | Result |
|------|--------|
| vitest (4 suites) | 697+1 (unwired) pass |
| APS BL-893 feature | 4/4 |
| Soft Gherkin | `outcome: inapplicable` — no Outline; not a pass |
| Surgical (6) | killed=6 survived=0 skipped=0 |

## Forward

`git_handoff` to `documenter`, priority `00`. Authorize BL-893 only.

By hardender.
