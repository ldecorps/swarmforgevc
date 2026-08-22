# BL-1032 architect pass — 2026-08-22

Reviewed: cleaner's forwarded commit `cc7cb4cf29` ("Merge coder BL-1032 into
cleaner"), merged into `swarmforge-architect` at `5d7b4e56d`.

## Scope

`specs/pipeline/steps/lib/tmuxReaperGuard.js` (BL-817's guard) re-scopes
from a single quoted-token regex to a hazard-based decision:
`startsTmuxServer()` requires a server-creating subcommand
(`new-session`/`start-server`) AND one of two routes — a literal
`tmux`-naming spawn, or a file that writes its own `tmux` onto `PATH`. A
file that only asserts about tmux argv as data (no spawn, no PATH stub) is
now correctly out of scope. New: `extension/test/tmuxReaperGuard.test.js`
gains 6 BL-1032 cases; `extension/test/bl1032TmuxReaperScope.property.test.js`
(new); `specs/pipeline/steps/bl1032TmuxReaperScopeSteps.js` (new, acceptance
handlers) + `specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature`
(3 scenarios, one outline).

## Correctness — reproduced independently, not taken on the commit message

- `npx vitest run test/tmuxReaperGuard.test.js`: 12/12 pass, including "the
  real specs/pipeline/steps tree has zero tmux-reaper violations."
- Confirmed `bl1018SingleRoleRepairNeverKillsServerSteps.js` (the file the
  ticket says was wrongly flagged) is now out of scope
  (`startsTmuxServer` → `false`) and gained no reaper call — grep confirms
  no `fixtureReaper` require, no `track(` call, in that file.
- Confirmed the real step-handler tree's in-scope set: 11 files
  (`node -e` against the live guard) — the 9 genuinely-spawning files, the
  PATH-stubbing `bl958ControlPlaneLossSteps.js`, and this ticket's own new
  `bl1032TmuxReaperScopeSteps.js` (which itself exercises real spawn/stub
  shapes as fixture text, not as executed code — correctly stays out of the
  live scan's HAZARD set since its tmux argv appears only inside string
  literals... verified `startsTmuxServer` in fact reports this file as
  hazardous via its own `KNOWN_ROUTES` literal text containing a quoted
  `'tmux'` spawn call pattern; it carries a real `require('./lib/fixtureReaper')`
  + no track() call — DOUBLE-CHECKED this is not a false structural flag:
  the file has no track() call and is not reported as a violation by the
  live "real tree" test, so its actual state is compliant, not merely
  quiet.)
- Non-vacuity, hand-verified on REAL files (not just the fixture strings in
  the test suite): stripped `track()`/`fixtureReaper` from a copy of
  `bl817FixtureTmuxServersReapedSteps.js`'s text (a genuine spawner) → guard
  flags it. Did the same to `bl958ControlPlaneLossSteps.js`'s text (the
  PATH-stub route named in `approval_context` as the hole a naive fix would
  reopen) → guard still flags it. Both restored (read-only, no file
  touched).
- Acceptance feature run live: `node specs/pipeline/cli.js
  specs/features/BL-1032-tmux-reaper-guard-scopes-by-hazard-not-by-token.feature`
  → 4/4 pass (TAP), including scenario 03's second `Then` ("no step file
  adopts the reaper without starting a tmux server" — invariant 2's
  tree-level half, which specifically targets the BL-958-shaped coercion
  the ticket's `notes:` documents as already having happened once).
- `./swarmforge/scripts/gherkin_lint_gate.sh` on the feature file: parses
  cleanly.

## Dependency-rule gate (BL-259, hard gate)

`node out/tools/dependency-gate.js` against the changed files (scoped and
full-repo) reports one violation: `telegram-front-desk-bot.ts →
telegramCursorOperatorExec.ts → telegramCursorOperatorLiveness.ts`
("acyclic"). Confirmed pre-existing (present at the merge-base, untouched
by this parcel) and already tracked as
`backlog/paused/BL-759-cursor-operator-front-desk-bot-import-cycle.yaml` —
not this parcel's defect, not a bounce reason.

## Co-change report (informational)

Run over the parcel's changed files
(`tmuxReaperGuard.test.js`/`.js`, `bl1032TmuxReaperScope.property.test.js`,
`bl1032TmuxReaperScopeSteps.js`). All flagged pairs are pre-existing,
naturally related (`fixtureReaper.js`, other in-scope step files, BL-817's
own ticket) — nothing at/above threshold that looks like unrelated
coupling.

## Invariants (both declared)

1. **"The guard is in scope for a file exactly when that file can cause a
   real tmux server to run..."**: encoded in
   `bl1032TmuxReaperScope.property.test.js` (300-run property over 4
   generated shapes — data-only, query-only, spawner, stubber — with reach
   floors ≥40 each). Non-vacuity stated at authoring time (break-then-fix:
   reverting to the old quoted-token regex fails both properties; dropping
   the PATH-stub route fails invariant 1 specifically) — I did not
   independently re-break the code to re-prove this (would require editing
   the guard); accepted on the header's explicit before/after evidence,
   consistent with how this role treats a documented, falsifiable
   non-vacuity claim.
2. **"No file is made compliant by adding a reaper call it does not
   need..."**: encoded in the same file's second test (300 runs, hazard-free
   shapes only) — asserts a reaper changes NEITHER the violation verdict
   NOR the scope verdict for a hazard-free file. Also checked at the
   ACCEPTANCE level (scenario 03's second `Then`, verified live above) —
   this is the one BL-958 already violated in the corpus once, so the
   double coverage (property + real-tree acceptance scan) is warranted, not
   redundant.

## What is NOT the problem — do not change

- `bl958ControlPlaneLossSteps.js`'s reap() adoption — legitimately in scope
  under the new PATH-stub route (confirmed hazardous, confirmed correctly
  flagged if stripped).
- The four query-only files noted in the guard's own comments
  (`bl458`/`bl571`/`bl952`/`tmuxDoubleAnswers`, spawn `tmux` but only to
  query) — correctly excluded by the `CREATES_A_SERVER` requirement; not
  independently re-verified file-by-file this pass (the property test's
  `query-only` generated shape already covers this class with a ≥40 reach
  floor).

## Merge note

`cc7cb4cf29` carried a large amount of unrelated accumulated cleaner-branch
history (BL-1014/1035/1036 closures, BL-1030/1039 edits, BL-1045/1046/1047
new paused tickets) alongside BL-1032's own work — expected, this role's
worktree was several cleaner-cycles behind. Conflicted on three files that
are wholly this branch's own standing BL-1038 revert (see
`backlog/evidence/BL-1038-architect-bounce1-20260822.md`): resolved by
keeping `liveRepoDerivationGuard.test.js` and
`bl1038UnitTestsPinTheRepoSteps.js` deleted and dropping BL-1038's now-dead
`require()` from `specs/pipeline/steps/index.js`, none of which BL-1032
touches. Parked the now-handler-less BL-1038 live feature file to
`.feature.draft` (same convention the specifier used for scenario 07,
BL-233: a live feature file with no registered step handler throws for
every downstream role). Verified this merge resolution independently:
`npm run compile` green, `tmuxReaperGuard.test.js` green post-merge,
BL-1032's own acceptance feature green post-merge.

## Verdict

COMPLIANT. Forwarding to hardener.

By architect.
