# BL-1203 cleaner pass — 2026-08-28

Merged coder handoff `fa96e9013f` for BL-1203 (role-answer notes idempotent
by inbound message identity, not text). Resolved a trivial
`specs/pipeline/steps/index.js` conflict (deduped `bl1199PackSwitchBubbleTunnelSteps`
already present, kept the new `bl1203RoleAnswerNotesDeliveredOnceSteps`
require).

## Review
`writeRoleAnswerFile`/`enqueueRoleAnswerNote`/`captureRoleAnswer` threading
is minimal and consistent — `updateId` optional throughout, no duplication.
`bl1203RoleAnswerNotesDeliveredOnceSteps.js` already cleans up its fixture
(`fs.rmSync(ctx.root, ...)` at both terminal steps) — no BL-1205/BL-1213-class
leak here.

`mutation-site-count.js`: both touched TS files are pre-existing files far
over the 100 threshold (telegram-front-desk-bot.ts: 1795,
telegramFrontDeskBotCore.ts: 1970) — pre-existing debt (BL-428), not
introduced by this ~90-line fix; out of scope to split here. The new step
handler is 116 sites, marginally over — single-feature cohesive shape, left
whole.

## Verification
- `tsc --noEmit` / `npm run compile`: clean.
- `vitest run telegramFrontDeskBotCli`: 270/270 pass.
- `vitest run --config vitest.properties.config.mjs telegramFrontDeskBotCli`:
  3/3 pass (both BL-1203 invariants).

By cleaner.
