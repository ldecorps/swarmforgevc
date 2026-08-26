# Stamp-off: concurrent Approvals hotfix stamp Yes/No (BL-1152)

BL-848 stamp-off for Cursor hotfix `7380d80686` (`Hotfix-Certification:
pending`). Green tests never write `certified` / `waived` into the hotfix
ledger — only a recorded human decision does.

## Landed behaviour under review

| Path | Confirm |
| --- | --- |
| `extension/src/tools/telegram-front-desk-bot.ts` | `resolveAskOptions` reads `.swarmforge/operator/hotfix-stamp-asks.json` for `hotfix-<commit>` thread ids. |
| same | Approvals Yes/No on those subjects call `hotfix_ledger_update --decide` via `applyHotfixStampAnswer`; not forwarded to the bridge ask path. |
| same | Ordinary (non-hotfix) asks still use the single `awaiting-answer.json` slot + `postToBridge`. |

## Stamp-off posture

- Confirm or refute landed commit `7380d80686` only — do not reimplement.
- Ledger stays `state: pending` / `human_decision: null` until Approvals /
  human decision ([BL-848](BL-848-certify-an-operator-hotfix.md)).

Acceptance:
`specs/features/BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686.feature`
