# BL-990: branch contamination cleared, forwarding to hardener (2026-08-21)

**Author**: architect, responding to QA's bounce
(`backlog/evidence/BL-990-bounce-20260821.md`, reviewed at QA tip
`16c0ed9ca`, bounce commit `0c89ef0f2a`).

QA bounced BL-990 to architect for D1 (behavior): the parcel's tree failed
`conciergeTick.test.js` 2/111, the exact same BL-979 pivot-revert
contamination already diagnosed and cleared for BL-986 earlier today
(`backlog/evidence/BL-986-architect-contamination-cleared-20260821.md`).
QA's own scope check already confirmed BL-990's own commit range
(`30998e3df..16c0ed9ca`) touches only its 10 declared files
(`bounceStore.ts`, `failureModeInventory.ts`, `leanLedgerComposeBounce.ts`,
`qaBounce.ts`, `record-bounce-correction.ts`, `recordBounceCorrectionArgs.ts`
and their 4 test files) — zero overlap with `pipelineBoard.ts` or
`conciergeTick.test.js`. Not a BL-990 defect.

## Fix

By the time this bounce arrived, the architect worktree had already cleared
the identical contamination while working BL-979/BL-986 this same shift
(`3d3506d6a` revert → `7ee9b4d40` merge cleaner's BL-979 D1 refix
(`e8ad302017`) → `50c1c279d` restore the pivot → `00e4de90b` forward BL-979
to hardener). Merged QA's BL-990 bounce commit forward
(`ef691042f`, `git merge --no-ff 0c89ef0f2a`) — a clean merge, no conflicts,
and it does not touch `pipelineBoard.ts` at all
(`git diff --stat 00e4de90b..ef691042f -- extension/src/tabs` is empty).

## Verification

- `npx vitest run test/conciergeTick.test.js`: **111/111 pass** (the exact
  two previously-failing assertions now pass).
- `npm run compile`: clean.
- **REQUIRED HARD GATE**: `node out/tools/dependency-gate.js` on BL-990's own
  6 changed `src/*.ts` files: **PASSED, no forbidden edges**.
- `node out/tools/co-change-report.js` on the same 6 files: no pair at or
  above the default threshold (frequency 3) — nothing flagged.
- Declared invariants (both — attribution-corrects-for-every-consumer,
  append-only-never-edits): `bl990BounceCorrectionInvariants.property.test.js`
  via `vitest run --config vitest.properties.config.mjs`: **pass**.
- BL-990's own unit suites (`bl990BounceCorrection.test.js`,
  `bl990BounceCorrectionStore.test.js`, `recordBounceCorrectionCli.test.js`):
  **31/31 pass**.
- BL-990 acceptance (`node specs/pipeline/cli.js
  specs/features/BL-990-bounce-attribution-correctable.feature`): **8/8
  PASS**.

## Full-suite attempt: host-load timeout, not a regression

Ran the full `npm test` to sanity-check for other regressions. Under today's
sustained multi-role host contention (matching the hardener's own BL-990
pass notes, load 20-46 throughout this shift) two unrelated files ran every
one of their tests into the default 20s timeout under full-suite contention:
`pausedPagerUiHtml.test.js` (4/4 timed out, 80s) and
`pwaApprovalDetail.test.js` (13/13 timed out, 260s). Neither is touched by
BL-990's diff, BL-979's diff, or BL-986's diff. Re-ran both in isolation:

- `npx vitest run test/pausedPagerUiHtml.test.js`: **4/4 PASS**, 545ms.
- `npx vitest run test/pwaApprovalDetail.test.js`: **13/13 PASS**, 2006ms.

Same isolation-recheck discipline QA already used today for
`renderBriefingDiagramsCli.test.js` (45s timeout under contention, 4/4 pass
isolated in 28s) — confirmed load-flake, not a regression from this merge.
Terminated the stalled foreground full-suite run by its own exact PIDs
(`recordTestDuration.js` and its two vitest children) rather than let it
keep burning host cycles on files already isolated-verified.

## Outcome

Forwarding to **hardener** (this ticket's own next stage), per QA's own
remediation note: "merge architect's current tip forward through this
ticket's own hardener → documenter → QA chain." BL-990's own domain is
unchanged by this merge (no code edits, only bringing forward the already-
landed architect fix); hardener's/documenter's earlier BL-990 passes remain
valid ancestors of this tip.
