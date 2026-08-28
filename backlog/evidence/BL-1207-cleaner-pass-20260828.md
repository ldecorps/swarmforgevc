# BL-1207 cleaner pass (2026-08-28)

## What I did

Merged coder handoff `11b8b9af1a` (BL-1207: move padded-pid case out of the
malformed table, assert liveness alone) into the cleaner worktree, then
reviewed for cleanup/hardening.

## Scope check

Only test-domain files changed: `extension/test/cursorBridgeAgentSession.test.js`,
`specs/pipeline/steps/bl1207AbandonedLockLivenessSteps.js` (new),
`specs/pipeline/steps/index.js` (registration). No `extension/src/**` or
`extension/out/**` file touched — production (`readLockHolderPid`'s
`.trim()`, `isProcessAlive`'s EPERM-as-alive branch) is untouched, per the
ticket's firm constraint.

## Cleanup Order applied

- Coverage: `npx vitest run test/cursorBridgeAgentSession.test.js` — 63/63
  passed (all pre-existing tests plus the 4 new/changed ones for this
  ticket).
- Mutation-site count (BL-485): not applicable — no `src/`/`out/` file
  changed by this parcel, so there is nothing for
  `mutation-site-count.js` to count.
- CRAP / DRY (`jscpd`): both tools scope `src/` only; no production file
  changed, nothing to run.
- Structure review: `MALFORMED_LOCK_CASES` and `DEAD_PID` are declared
  once at module scope and reused by both the verdict test and the
  non-vacuity guard, matching the ticket's own discipline precedent
  (`bl984FixtureSweep.property.test.js`'s `DEAD_PID_BASE`). The new
  acceptance step handler drives the real compiled module
  (`extension/out/bridge/cursorBridgeAgentSession.js`), not a
  reimplementation, and keys its structural-guard step on the same
  `MALFORMED_CONTENTS` list the unit test iterates, per the ticket's
  anti-prose-grep constraint. No duplication or structural issue found;
  no changes made.

## Verdict

No cleanup changes needed — the coder's parcel is already well-scoped,
tested, and structurally sound. Forwarding to architect unchanged.
