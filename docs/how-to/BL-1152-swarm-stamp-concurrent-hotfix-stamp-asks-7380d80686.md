# Stamp-off: concurrent Approvals hotfix stamp Yes/No (BL-1152)

*How-to. Task-oriented: certify or waive a landed operator hotfix when multiple
stamp asks can be open at once on Approvals.*

BL-848 stamp-off for Cursor hotfix `7380d80686` (`Hotfix-Certification:
pending`). Green tests and QA approval **never** write `certified` / `waived`
into the hotfix ledger — only a recorded human decision does
([BL-848](BL-848-certify-an-operator-hotfix.md)).

## Problem this hotfix solves

Before `7380d80686`, every Approvals Yes/No ask shared one
`awaiting-answer.json` slot. A second concurrent hotfix stamp ask could not
resolve its buttons until the first ask cleared — blocking certify/waive on
later hotfixes.

## Landed behaviour (confirm only — do not reimplement)

| Path | Behaviour |
| --- | --- |
| `extension/src/tools/telegram-front-desk-bot.ts` | `resolveAskOptions` reads `.swarmforge/operator/hotfix-stamp-asks.json` for `threadId` values starting with `hotfix-` (e.g. `hotfix-7380d80686`). |
| same | `postToBridgeOrHotfixStamp` routes `hotfix-*` subject ids to `applyHotfixStampAnswer` → `bb hotfix_ledger_update.bb --decide <commit> approved\|waived` via `spawnSync`. |
| same | Ordinary (non-hotfix) asks still use the single `awaiting-answer.json` slot and `postToBridge`. |

## Operator workflow

1. Hotfix lands on `main` with `Hotfix-Certification: pending` (BL-848).
2. Coordinator mints a stamp ticket (BL-1152 for `7380d80686`).
3. Operator posts concurrent stamp asks under `.swarmforge/operator/hotfix-stamp-asks.json`:

```json
{
  "hotfix-7380d80686": {
    "options": [
      { "label": "Yes — certify", "value": "yes" },
      { "label": "No — waive", "value": "no" }
    ]
  }
}
```

4. Approvals renders Yes/No for each `hotfix-<commit>` thread independently —
   no `awaiting-answer.json` match required.
5. Human taps Yes or No → ledger `--decide` runs; commit the updated
   `backlog/hotfix-ledger.yaml`.

## Stamp-off posture

- This parcel confirms landed commit `7380d80686` only — acceptance diffs the
  file against that commit; do not rewrite `telegram-front-desk-bot.ts` here.
- Ledger stays `state: pending` / `human_decision: null` until Approvals /
  human decision.

## Verify

```bash
cd extension && npm test -- --run telegramFrontDeskBotCli.test.js -t BL-1152
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686.feature
```

Acceptance:
`specs/features/BL-1152-swarm-stamp-concurrent-hotfix-stamp-asks-7380d80686.feature`
