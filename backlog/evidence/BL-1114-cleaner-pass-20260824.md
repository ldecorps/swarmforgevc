# BL-1114 cleaner pass — 2026-08-24

## Inbound

Merged coder commit `046358e2ee` (exhausted recovery: terminal note + wake +
move `.dead` to `handoffs/failed/`) into `swarmforge-cleaner` via
`git merge --no-ff`. Ancestry: `git merge-base --is-ancestor 046358e2ee HEAD`.

## Checks run

1. **Unit** — `npx vitest run test/handoffRecovery.test.js`: 15/15 pass.
2. **Property** —
   `npx vitest run --config vitest.properties.config.mjs test/bl1114DeadLetterNotSilent.property.test.js`:
   1/1 pass.
3. **Gherkin acceptance** —
   `node specs/pipeline/cli.js specs/features/BL-1114-dead-letter-quarantine-must-not-be-silent.feature`:
   4/4 pass.

## Cleanup performed

- `installTerminalRecoveryNote`: single `Date` for stamp + `created_at`
  (no dual clock skew).
- Stamp format uses the same `[-:]` + fractional-Z strip pattern as
  `cursor-seat-spike` rather than a no-op `Z→Z` replace.

## Findings beyond that

NONE. Escalation path stays note → dispose → needs-human → wake → log;
corrupt quarantine still shares `*.handoff.dead`.

## Forward

`git_handoff` to `architect`, priority `00`, task
`BL-1114-dead-letter-quarantine-must-not-be-silent`.

By cleaner.
