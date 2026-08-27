# BL-1093 — hardener pass (bounce re-fix), 2026-08-24

## Inbound

Fast-forwarded architect `dac76dffa4` (on cleaner hitchhiker-strip tip
`b9af79f6c3` / coder `e2bbe4d6e4` over implement `572a19ba37`) into
`swarmforge-hardender`.

## Bounce clearance (architect D1–D3)

| Item | Check | Result |
|---|---|---|
| D1 feature | BL-1113 acceptance named `&nbsp;` | 9/9 |
| D2 done YAML | narrative `&nbsp;` | OK |
| D3 Specification | `escapeHtml` emits `&nbsp;` | OK |
| pack + HOTFIX_PATHS | `git diff --quiet 27273f2b0a` × 6 | OK |
| BL-1113 properties | 2/2 | OK |

## Scope (BL-1093)

`nobody-assigned?` normalisation at the read boundary; complementary
dispatch-gap / unassigned-active; draft belt-and-braces. No
`extension/src/**` — Stryker/CRAP/DRY N/A.

## Host

Load ~2 on 20 cores (quiet).

## BL-113 Gherkin (soft)

```
total=4 completed=4 killed=4 survived=0 errors=0
outcome: "pass"
```

Manifest stamped into the feature (Outline 01).

## Hand-authored surgical sweep

| # | Mutant | Result |
|---|--------|--------|
| M1 | `nobody-assigned?` always false | killed (unit) |
| M2 | only `(nil? assigned-to)` | killed (unit) |
| M3 | drop `"none"` from spellings | killed (unit) |
| M4 | case-sensitive spellings | killed (unit) |
| M5 | `read-active-items` keeps nobody | killed (unit) |
| M6 | draft belt `when-not nobody` → always allow | killed (unit) |

Survivors: 0.

## Verification

- `dispatch_gap_test_runner.bb` ALL PASS
- BL-1093 acceptance 8/8; properties 3/3
- Standing whole-tree guards 125/125
- CRAP / DRY / Stryker: N/A

## Findings

NONE.

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1093-an-active-ticket-with-no-real-assignee-strands-between-two-sweeps`.

By hardender.
