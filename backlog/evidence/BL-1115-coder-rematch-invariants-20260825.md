# BL-1115 — coder rematch after architect bounce D1 — 20260825

Architect bounce `bea024f737`: declared invariants unencoded (BL-633/BL-654).

## Remediation

- Added `extension/test/bl1115MainSyncStatusCliStampOff.property.test.js`
  (runs via `npm run test:properties` only).
- Invariant 1: fast-check over hotfix paths — working-tree blob equals
  `a3bf11b533` for `main_sync_status_cli.bb`.
- Invariant 2: ledger row for `a3bf11b533` stays `state: pending` /
  `human_decision: null` (never certified/waived from green tests).
- Appended pending ledger entry for `a3bf11b533` / `stamp_ticket: BL-1115`
  (was missing; required for non-vacuous ledger assertions).

## Non-vacuity

- Break blob → invariant 1 RED; restored.
- Flip ledger `state: certified` → invariant 2 RED; restored.

## APS

`node specs/pipeline/cli.js specs/features/BL-1115-…feature` → 7/7 PASS.
Hotfix blob identity unchanged (`git diff --quiet a3bf11b533:… HEAD:…`).

By coder.
