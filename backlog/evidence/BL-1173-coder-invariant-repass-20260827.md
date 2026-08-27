# BL-1173 — coder re-pass (invariant property encoding)

Commit: this parcel · 2026-08-27 · worktree `swarmforge-coder`
Responds to architect bounce `3849682655` / evidence
`BL-1173-architect-bounce-20260827.md`.

## Remediation

All three declared `invariants:` now have coder-authored
`extension/test/deprecateCheck.property.test.js` encodings:

| # | invariant | property |
|---|---|---|
| 1 | CLI failure / malformed → fail closed (never allow) | P1 / P1b over `interpretFreshnessCliOutput` |
| 2 | Expedite never bypasses freshness gate | P2 / P2b over `mayPromoteGivenFreshness` |
| 3 | On hold → stays paused + priority-00 specifier note | P3 over `holdPromoteSideEffects` |

Pure helpers live in `deprecate-check.ts`; `promote_and_route_next.sh`
interprets CLI stdout via `interpretFreshnessCliOutput` (same fail-closed
path the properties lock).

## Vacuity

Deliberately broke `mayPromoteGivenFreshness` to always return `true`;
P2 and P2b failed (`true !== false`). Restored; properties green.

## Verification

| check | result |
|---|---|
| `deprecateCheck.property.test.js` | 5/5 |
| `deprecateCheck.test.js` | 7/7 |
| vacuity probe (broken mayPromote) | red → restored green |

Architect merge tip was entangled; re-pass is tip-pure cherry-pick onto
`origin/main` (same pattern as prior BL-1173 / BL-780).

By coder.
