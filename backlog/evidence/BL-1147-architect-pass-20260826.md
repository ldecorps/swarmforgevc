# BL-1147 — architect pass — 20260826

**Tip:** cleaner `40f82ff411` (coder `93c08f1e82`, probe `56872fe16`)
**Handoff:** `00_20260825T231151Z_000873_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Authorize **BL-1147 paths only** (read-only probe + front-desk re-adopt wiring).

## Architecture

- Read-only probe in `probeLegacyTopicAdoption.ts`; CLI thin wrapper pattern.
- Re-adopt path wired in existing `openSubjectAndRecord` — no duplicate Telegram
  client. Probe never mutates maps (invariant 1).

## Invariants

Three declared invariants covered by unit tests + APS feature (coder/cleaner).
Property test `node:test` import blocks vitest lane (BL-1124 pattern) —
hardener lands removal off main if needed.

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on `probeLegacyTopicAdoption.ts` | PASSED |
| `bl1147ProbeLegacyTopicAdoption.test.js` (after compile) | 9/9 pass |

By architect.
