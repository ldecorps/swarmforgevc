# BL-1188/BL-1189 cleaner merge-up recovery (2026-08-28)

## Context

Second occurrence in a row (see
`backlog/evidence/BL-592-cleaner-merge-recovery-20260828.md` for the first,
minutes earlier): a QA merge-up broadcast `note` (BL-1200 QA-approved,
`6bc23c7def`) tried to silently drop already-shipped feature code with no
authoring commit anywhere explaining the loss.

## What the merge silently reverted

Confirmed via the same method as the prior recovery — diff the merge
result against this worktree's own healthy HEAD, and where an add-commit
for the missing content is an ancestor of QA's tip but the content is
absent there with nothing in `git log` touching the path:

- `extension/src/bridge/pipelineGridLive.ts` — BL-1188's
  `readLiveRoleHeldTickets`/`resolveRoleHeld` (live-report-over-stale-cache
  fix) entirely missing; `capturePipelineGridLive` reverted to reading the
  stale cache directly. Add-commit `daa10afce` confirmed ancestor of QA tip.
- `extension/src/concierge/residentPaneSpy.ts` — BL-1189's `isTicketActive`
  guard and `buildResidentHeldTicketMeta` extraction missing;
  `resolveResidentHeldTicketMeta` reverted to a version with no
  active-ticket gate. Add-commit `e8e14057e` confirmed ancestor of QA tip.
- `extension/src/bridge/residentPaneLive.ts` — BL-1189's
  `dedupePrimaryWorkingTicket` wiring (per-capture same-ticket dedup)
  missing from `tryCaptureRolePane`/`captureLiveScreenPanes`.
- `specs/pipeline/steps/bl1188PipelineGridLiveStageParitySteps.js`,
  `bl1189LiveScreenOnePrimaryWorkingTicketSteps.js`,
  `bl592SpecTreeOnLiveConsoleWithEpicTierSteps.js` — modify/delete
  conflicts, QA side deleted; kept HEAD (BL-592's step handler is a repeat
  drop — this is the second time in two consecutive merges).
- `specs/pipeline/steps/index.js` — content conflict; QA's side had only
  `bl1200GitEnvGuardSteps` where HEAD had seven requires accumulated
  through this session's own pipeline work. Kept HEAD's full list.
- `extension/test/bl1188PipelineGridLiveStageParityInvariants.property.test.js`,
  `bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js`,
  `pipelineGridLive.test.js`, `residentPaneLive.test.js` (BL-1189 tests),
  `residentPaneSpy.test.js` (BL-1189 tests + `dedupePrimaryWorkingTicket`
  import) — all silently dropped; restored.
- Six evidence files (`BL-1188-cleaner-branch-corruption-property-suite`,
  `BL-1188-coder-pass`, `BL-1189-coder-pass`, `BL-428-coder-dispatch-
  investigation`, `BL-592-coder-bounce-fix`,
  `architect-vitest-node-test-no-suite-found`, all `-20260827`) — restored
  regardless of ancestor-check result (two of the six had no common
  ancestor with QA's line at all, i.e. simple divergence rather than
  confirmed revert, but evidence files cost nothing to keep and losing one
  silently was the exact failure mode to avoid).

## What I did NOT touch (legitimate forward progress)

- `backlog/active/BL-428-*.yaml` and `BL-751-*.yaml` deletions — both are
  real QA-approved closes (`Close BL-428: move to done`, `Close BL-751:
  move to done`), landed correctly to `backlog/done/`. The `BL-751` path
  was a rename/rename conflict (HEAD: hold→active, QA: hold→done); took
  QA's `done` since it reflects the ticket's actual, more advanced state.
- `backlog/paused/BL-1200-*.yaml` — QA/documenter added an `abandoned_commits`
  note about a separately-known corrupted-tree commit (BL-1124 class);
  additive, kept.
- `swarmforge/packs/full-forge.conf` — `active_backlog_max_depth` 7→6, a
  deliberate operator/coordinator tuning value, not a revert; kept QA's.

## Verification (all green post-restore)

- `npm run compile` — clean.
- `residentPaneLive.test.js`, `residentPaneSpy.test.js`, `pipelineGridLive.test.js` — 49/49 pass.
- `bl1188PipelineGridLiveStageParityInvariants.property.test.js`, `bl1189LiveScreenOnePrimaryWorkingTicketInvariants.property.test.js` (scoped `vitest.properties.config.mjs` run, not the full `npm run test:properties`) — 7/7 pass.
- BL-1188 (5/5), BL-1189 (5/5), BL-592 (8/8) acceptance features via `specs/pipeline/cli.js` — all pass.

## Pattern note

This is now two consecutive QA merge-up notes, each silently reverting a
different set of already-shipped tickets, both traced to content missing
on QA's branch line despite the authoring commit being a confirmed
ancestor. Combined with this session's already-documented "swarmforge-
architect tree collapse" and BL-1198 git-index-collapse hypothesis, this
looks like a systemic issue on the QA/main line, not an isolated fluke —
worth the coordinator/human's attention beyond this recovery.

By cleaner.
