# BL-1356 — QA re-verification and land, 2026-09-04

## Context

Resumed via coordinator `note` (priority `00`): "BL-1356 already
QA-approved (ef1307af6f) unlanded, not fresh coder work." Confirmed:
`ef1307af6f` is already an ancestor of this worktree's HEAD but not of
`origin/main`. Per `BL-1356-land-escalate-20260903.md`, it was blocked
purely by two genuinely-unlanded siblings sharing `specs/pipeline/steps/
index.js`: BL-1296 and BL-1309 (five other named siblings in that
escalation were already-landed false positives, the known per-ticket-not-
per-path shape). Both real blockers landed by QA this session
(`a72336cd8f`, `f7b512ea80`); BL-1371 (directory discovery) additionally
removed the shared-file coupling mechanism itself.

## Re-verification

BL-1356's own code has not changed since its QA approval; re-ran rather
than trusted:

- `npm run compile` — clean.
- `npx vitest run bl1356StampOffHelper.test.js` — 21/21 pass.
- `npx vitest run --config vitest.properties.config.mjs
  bl1356StampOffInvariants bl1113CursorHotfixStampOff
  bl1115MainSyncStatusCliStampOff bl1116ExtensionWipHotfixStampOff
  bl1117PipelineBoardNumericNbspStampOff
  bl1136BabysitterdCursorForgeStampOff` — 6 files, 11 tests, all pass —
  the invariant itself plus the five downstream stamp-off tests it
  discharged from the standing allowlist, confirmed still green under the
  run-scoped assertion.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1356-stamp-off-invariant-watches-the-run-not-the-row.feature`
  — 6/6 pass, matching the original QA approval's evidence.
- `swarmforge/scripts/property_suite_standing_allowlist.tsv` — confirmed
  none of the five stamp-off files (bl1113/1115/1116/1117/1136) still
  carry a row, matching the ticket's own discharge claim.
- Wiring: `bl1356StampOffWatchesTheRunSteps.js` exports `registerSteps`
  (line 189); no `index.js` mention needed under discovery.
- Process hygiene: no orphaned test/mutation processes before or after.
- `human_approval: approved`, no `ruling_options` — a plain approval.

## Landing

`bb swarmforge/scripts/land_step_cli.bb
BL-1356-stamp-off-invariant-watches-the-run-not-the-row <HEAD>`. Full
accounting in `BL-1356-land-success-20260904.md`.

By QA.
