# BL-1032 architect pass — 2026-08-22 (live-line port)

**Parcel:** cleaner-forwarded commit `fa3cbd59b7` ("Merge commit
'af2eead4c8' into swarmforge-cleaner"), merged into `swarmforge-architect`
at `b25e44cfb` (conflict in `specs/pipeline/steps/index.js` against BL-1038's
bounced-and-reverted registration — resolved by keeping BL-1048's and
BL-1032's entries and dropping BL-1038's; verified no BL-1038 file
resurfaced post-merge).

## Same content already reviewed once, on a stranded branch

Per the coder's own evidence
(`backlog/evidence/BL-1032-coder-port-20260822.md`), this ticket's full
pipeline already ran once on an `origin/cutover/wsl-2026-08-22-*` snapshot
branch that never reached `main`/the live line: coder → cleaner → **architect
(`4d4a718a4`, COMPLIANT)** → hardener → documenter. This parcel ports only
the coder-stage commit onto the live line (correctly, per BL-506 — later
stages are not the coder's to re-deliver).

Diffed the actual implementation files between that prior architect pass's
reviewed tree and this parcel's merge tip:

    git diff 4d4a718a4 b25e44cfb -- specs/pipeline/steps/lib/tmuxReaperGuard.js \
      specs/pipeline/steps/bl1032TmuxReaperScopeSteps.js \
      extension/test/tmuxReaperGuard.test.js \
      extension/test/bl1032TmuxReaperScope.property.test.js \
      specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature

**Empty diff — byte-identical.** That prior pass's findings apply to this
content directly; re-verified the load-bearing claims independently below
rather than taking either commit message on faith.

## Correctness — reproduced independently on this branch

- `npx vitest run test/tmuxReaperGuard.test.js`: **12/12 pass**, including
  "the real specs/pipeline/steps tree has zero tmux-reaper violations."
- `node -e` against the real, compiled guard
  (`scanForTmuxReaperViolations('../specs/pipeline/steps')`): `[]` — zero
  violations on the live tree.
- `bl1018SingleRoleRepairNeverKillsServerSteps.js` (the file the ticket says
  was wrongly flagged): grep for `fixtureReaper`/`track(` — **no match**.
  The firm constraint holds: it went green without gaining a reaper call.
- Non-vacuity, hand-verified in-memory against real files (no file touched):
  - `bl817FixtureTmuxServersReapedSteps.js` (genuine spawner):
    `startsTmuxServer` → `true`; stripping its reaper text in-memory and
    re-scanning → violation reported. Guard still bites.
  - `bl958ControlPlaneLossSteps.js` (the PATH-stub route named as the hole a
    naive "no literal tmux spawn" fix would reopen): `startsTmuxServer` →
    `true`. The measured warning in `approval_context` is closed.
- Acceptance feature run live: `node specs/pipeline/cli.js
  specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature`
  → **4/4 pass**, including scenario 03's second `Then` ("no step file
  adopts the reaper without starting a tmux server").
- `npm run test:properties -- test/bl1032TmuxReaperScope.property.test.js`:
  **2/2 pass** (both declared invariants, generator-shape coverage per the
  prior pass's read of the file's own header).

## Dependency-rule gate (BL-259, hard gate)

`node out/tools/dependency-gate.js` scoped to this parcel's two extension
files (`tmuxReaperGuard.test.js`, `bl1032TmuxReaperScope.property.test.js`):
**PASSED — no forbidden edges.** Unlike BL-1038's parcel (which pulled in
the pre-existing `telegram-front-desk-bot.ts` acyclic cycle through
`telegramFrontDeskBotCli.test.js`'s import chain), this parcel's files don't
reach that module at all.

## Co-change report (informational, BL-255)

Run over the parcel's two extension files. All flagged pairs are at
frequency ≤2 (below the default suspected-coupling threshold of 3) and are
naturally related: `tmuxReaperGuard.js`, `fixtureReaper.js`, sibling
step-handler files that also touch the reaper family, BL-817's own ticket.
Nothing suspicious, nothing this parcel introduces.

## Invariants (both declared)

1. **"The guard is in scope for a file exactly when that file can cause a
   real tmux server to run."** Encoded in
   `bl1032TmuxReaperScope.property.test.js`; re-ran, 2/2 pass. Independently
   confirmed the two boundary cases by hand above (genuine spawner still
   flagged, PATH-stub route still flagged, assert-only file not flagged).
2. **"No file is made compliant by adding a reaper call it does not
   need."** Same property file's second test, plus acceptance scenario 03's
   second `Then` (the BL-958-shaped coercion the ticket's own `notes:`
   records as having already happened once in the corpus) — re-ran live
   above, passes.

## What is NOT the problem — do not change

- `bl958ControlPlaneLossSteps.js`'s reap() adoption — legitimately in scope
  under the PATH-stub route, confirmed hazardous.
- The four query-only files the guard's own comments name as correctly
  excluded — not independently re-verified file-by-file (the property
  test's query-only generated shape already covers this class), consistent
  with the prior pass's scoping.
- `tempDirTrapGuard.test.js`'s standing red
  (`bl1025_expedite_approval_property_runner.bb`) — confirmed its
  last-touching commit `71ee902a2` is an ancestor of both `main` and
  `origin/main`, i.e. pre-existing and unrelated to this parcel (tracked
  separately as BL-1033/BL-1025). Not this parcel's defect.

## Verdict

COMPLIANT. Forwarding to hardener with the live-line commit.

By architect.
