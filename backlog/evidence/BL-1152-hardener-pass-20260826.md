# BL-1152 hardener pass — stamp-off hotfix 7380d80686 — 20260826

**Architect tip:** `357874b451`
**Task:** `BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686`

## Merge

- `merge_and_process architect 357874b451` (clean merge).

## Stamp-off invariant

- `git diff --quiet 7380d80686 HEAD -- extension/src/tools/telegram-front-desk-bot.ts` — **empty** (no reimplementation).

## Gates

| Gate | Result |
|------|--------|
| `vitest -t BL-1152` | 5/5 |
| APS BL-1152 | 3/3 |
| Gherkin mutation | inapplicable (no Scenario Outline) |
| Surgical mutation sweep | 5/5 killed |

## Hardening added

- Two source-structure tests locking `applyHotfixStampAnswer` yes/no mapping and
  `postToBridgeOrHotfixStamp` hotfix routing (stamp-off allows test-only assertions).
- `bl1152_telegram_front_desk_hotfix_stamp_mutation_sweep.sh`.

Pass → documenter.
