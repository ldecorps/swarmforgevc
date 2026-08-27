# BL-1152 — architect pass rematch — 20260826

- merge_and_process cleaner recut `537116c2fc` (QA bounce D1: tip entangled with
  BL-653/660/588/1162/1160; modify/delete conflicts resolved — preserved BL-1162
  in-flight files on architect branch; restored bl1162 handler in index.js).
- Reviewed recut purity vs `origin/main`: 15 BL-1152-only paths; sibling
  hitchhiker grep — empty.

## Architecture / boundaries

- Stamp-off confirms hotfix `7380d80686` only — `git diff --quiet` vs that commit
  for `telegram-front-desk-bot.ts` is empty.
- Hotfix paths in extension-host I/O: `resolveAskOptions` reads
  `hotfix-stamp-asks.json`; `applyHotfixStampAnswer` → `hotfix_ledger_update --decide`;
  non-hotfix threads unchanged — no webview/storage breach.
- APS handler registered in `specs/pipeline/steps/index.js`.

## Invariants (BL-633)

- Reimplementation invariant: step handler enforces byte-identity vs `7380d80686`.
- Ledger invariant: routing to `--decide` only; no auto-certification.

## Verification

- Dependency gate on `telegram-front-desk-bot.ts`: **PASSED**
- `vitest -t BL-1152`: **5/5 PASS**
- `bl1152_telegram_front_desk_hotfix_stamp_mutation_sweep.sh`: **5/5 killed**
- QA bounce D1 remediation confirmed on recut tip

Inventory: NONE

Pass → hardender.

By architect.
