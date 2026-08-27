# BL-1188 — hardener pass — 20260827

## Inbound

Received `git_handoff` from architect naming commit `88d8b7c7a1` (merges
cleaner's forward of coder's re-fix for the D1 bounce: `readLiveRoleHeldTickets`/
`resolveRoleHeld` reinstated in `pipelineGridLive.ts`). Sanity-checked before
merging (9822-file tree, sane merge-base at my own recent `0bf05774ac`, clean
`--no-commit` dry run, no mass deletion) — this one is sound. Merged as
`fa5fde7a9`.

This ticket had an extensive same-day bounce saga (see
`BL-1188-architect-bounce*.md`, `BL-1188-cleaner-branch-corruption*.md`,
`BL-1188-record-bounce-false-positive*.md`): a session-wide corruption
incident silently reverted the live-report fix while the coordinator's
13-file recovery restored everything EXCEPT `pipelineGridLive.ts` itself
(never missing from disk, just holding stale reverted content). Architect
correctly diagnosed and bounced; coder reinstated the fix exactly as the
original `daa10afce` had it. Read all five prior evidence files before
starting my own pass.

## What BL-1188 delivers

`readLiveRoleHeldTickets` (sync, `execFileSync('bb', [pipeline_stage_cli.bb,
targetPath, 'report'])`) + `resolveRoleHeld` (try live, catch falls back to
the coordinator cache only when the live report is genuinely unavailable) +
`capturePipelineGridLive` now calls `resolveRoleHeld` instead of the
cache-only `invertTicketStageToRoleHeldTickets(readTicketStageMap(...))`
directly. Also a rewritten step handler (`bl1188PipelineGridLiveStageParitySteps.js`)
with proper fixture cleanup (the bounce's D2, already architect-verified).

## Gates

| Gate | Result |
|---|---|
| Compile | PASS |
| Unit `pipelineGridLive.test.js` | 6/6 PASS (via `npx vitest run --config vitest.config.mjs` — NOT bare `node --test`, per this ticket's own architect-bounce-correction lesson) |
| Property (2 declared invariants) | 3/3 PASS |
| Acceptance (`run_acceptance.sh`) | 5/5 PASS |
| Regression (`pipelineBoard*`, `residentPaneSpy`, `residentPaneLive`) | 281/281 PASS, no leaked `bl1188-*` tmp dirs from my own runs |
| Fixture cleanup (D2) | Spot-verified via direct reading: every fixture-touching step in the handler is guarded by `try/finally { cleanupFixture(ctx) }` or `catch { cleanupFixture(ctx); throw e; }` — matches architect's own D2 pass finding, no gap |
| CRAP (scoped to `pipelineGridLive.ts`) | 1 flagged (`<anonymous>` CRAP=7.23, the pre-existing `paused.map` humanApproval ternary) — confirmed **untouched by BL-1188's diff** (0 hits), pre-existing debt, out of scope. `resolveRoleHeld`/`readLiveRoleHeldTickets`/`capturePipelineGridLive` (BL-1188's own new/changed code): 2.00 / 1.00 / 3.15, all clean |
| DRY (`jscpd`, scoped) | 0 clones |

## Mutation: automated Stryker blocked again — 5th unrelated pre-existing defect found

BL-149 cooldown gate: `DECISION: run` (file age 36d, host quiet). Attempted
scoped `stryker run --mutate out/bridge/pipelineGridLive.js`
(`CURSOR_API_KEY` workaround from earlier today reused for the dry run).
Hit a **new, 5th** unrelated pre-existing defect not seen on BL-1190's pass:
a whole-tree guard test (`BL-1038: the real extension/test tree has no
unjustified live-repository derivation`) fails because
`docsStructureRealTree.test.js` and `pilotMkdtempConventionCheck.test.js`
hand the live repository root to production code with no recorded
justification. Confirmed unrelated (0 diff hits against my merge-base) and
unticketed (grepped backlog). Sent as a `note`. Notably
`pilotMkdtempConventionCheck.test.js` is the SAME file whose
`loadRawMkdtempGuard` path-resolution bug I found during BL-1190's pass a
few minutes earlier — plausibly the same root cause surfacing two ways.

Given the full unit suite is now confirmed red from (at least) 5 independent
directions today, stopped attempting the automated dry run and fell back to
the **hand-authored mutation sweep (BL-638 pattern)** again, scoped to
BL-1188's own changed logic:

`pipelineGridLive.ts` (2/2 killed, both on the exact defect class this
ticket exists to fix):
- MA: `resolveRoleHeld` reverted to always use the cache (bypassing the live
  read entirely — the ORIGINAL pre-fix bug) — killed: the freshness-across-
  ticks assertion fails (`assert.notEqual(firstRow, secondRow)`), exactly
  the failure shape architect's own bounce evidence described.
- MB: the `catch` block rethrows instead of falling back to the cache when
  the live report is genuinely unavailable — killed: the
  no-`pipeline_stage_cli.bb`-script fixture scenario throws uncaught instead
  of rendering from cache.

Both applied to a backed-up copy of the compiled file, restored via `cp` +
`diff` verification after each.

## For the specifier

This is the SECOND ticket in a row (after BL-1190) where automated Stryker
could not even start due to unrelated pre-existing full-suite reds — 5
independent instances found across the two passes today. This is no longer
scattered noise; it is a standing condition blocking mutation hardening
repo-wide until at least the PID-42 and `CURSOR_API_KEY` gates are addressed.

## Forward

`git_handoff` to `documenter`, priority `00`, task `BL-1188-pipeline-grid-live-stage-parity`.

By hardender.
