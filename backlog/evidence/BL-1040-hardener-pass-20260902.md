# BL-1040 — hardener pass, 2026-09-02

Reviewed commit `ebac511699` (architect clean sweep), merged into hardender
as fast-forward `ebac511699`. Real production change this time: the
observation-path seat-fold across `swarmforge/scripts/pipeline_stage_cli.bb`,
`extension/src/swarm/swarmState.ts`, and `extension/src/concierge/pipelineBoard.ts`.

## Load / process hygiene
- `uptime` at start: load average ~2-4 on 20 cores — quiet, no bypass needed.
- `pgrep -fl 'node --test|stryker'`: no strays before starting.
- BL-149 file-change cooldown gate: `mutation_cooldown_gate.bb` returned
  `DECISION: run` for both changed TS files (file_age_days 6.64 and 3.41,
  both past the 3-day cooldown; host load read quiet).

## TypeScript side — Stryker blocked, hand-authored fallback used
- Attempted a real Stryker run scoped to `out/swarm/swarmState.js`
  (`--ignoreStatic --concurrency 4`, per BL-713's documented technique).
  The dry run failed on a pre-existing, unrelated standing red
  (`liveRepoDerivationGuard.test.js`, tracked BL-1291) — confirmed by a
  standalone `npx vitest run` showing the SAME failure with zero BL-1040
  file overlap. Excluding just that one file surfaced a WIDER set: a plain
  `npx vitest run` with no exclusions showed **24 failing files, 26 failing
  tests**, none overlapping BL-1040's changed files
  (`test/backendSwitch.test.js`, `test/constitutionDocCitations.test.js`,
  `test/crossFileDuplicationCheck.test.js`, `test/multiBranchParserCoverageCheck.test.js`,
  `test/operatorRuntimeBbFixtureClosure.test.js`, `test/perHatRolePromptEvidenceCheck.test.js`,
  `test/pilotAcceptanceGate.test.js`, `test/pilotScopedCrapCheck.test.js`,
  `test/shellEntryPointDriveCheck.test.js`, `test/socketFixtureShortRootGuard.test.js`,
  `test/telegramClient.test.js`, `test/telegramCursorOperatorExec.test.js`,
  `test/tempDirTrapGuard.test.js`, `test/unreachableStepHandlerCheck.test.js`,
  `test/liveRepoDerivationGuard.test.js`; matches BL-1244's precedent of
  widespread unrelated standing reds).
- Built a temporary, uncommitted Stryker-only vitest config
  (`extension/vitest.stryker-bl1040.tmp.config.mjs` + matching
  `stryker.bl1040.tmp.config.json`) excluding exactly those unrelated
  failing files so the dry run's coverage-analysis pass could proceed
  without touching any tracked file. Confirmed clean first with a plain
  `vitest run --config` (570 files, 9600 tests, all green). Launched the
  actual Stryker run via `detach_job.sh` (per the documented >120s escape
  hatch) — it then hit a SECOND, different unrelated failure INSIDE the
  Stryker sandbox itself (a `git archive` of a historical commit failing
  on a path that doesn't exist at that commit, in a fix-commit-size test),
  a failure mode specific to the sandbox's own git-archive step, not
  reproducible outside Stryker. Given the growing, unrelated,
  environment-wide breakage (consistent with BL-1244's "main and
  origin/main have diverged significantly" note), stopped chasing Stryker
  further rather than keep excluding an open-ended set of unrelated files.
  All temporary Stryker artifacts (`vitest.stryker-bl1040.tmp.config.mjs`,
  `stryker.bl1040.tmp.config.json`, `stryker-incremental-bl1040-tmp.json`,
  `.stryker-tmp/`) deleted — nothing committed, `git status` confirmed clean
  of them.
- **Fell back to a hand-authored mutation sweep** (same posture as the
  Babashka/no-tool fallback, applied here because the real tool is
  environmentally blocked rather than absent) on every function this
  parcel's diff touched or added, verified against
  `test/pipelineBoard.test.js` + `test/state.test.js` (172 tests) and the
  property test (4 properties, 300 runs each) — each mutant hand-applied,
  compiled, and confirmed to fail the suite, then reverted and confirmed
  green again:
  1. `stageOfSeat`: flip `at === -1` to `at !== -1` — killed (29+4 test
     failures).
  2. `stageOfSeat`: remove the `.slice(0, at)` fold entirely — killed (6+3
     failures).
  3. `heldRoleByTicketId`: revert the per-key fold to the pre-BL-1040
     direct `roleHeldTickets[role]` lookup — killed (3+2 failures).
  4. `heldRoleByTicketId`: reverse the `ALL_SWARM_ROLES` iteration order
     (precedence check) — killed (8+1 failures).
  All four confirmed real, not vacuous — no test file, git diff, or
  compiled artifact was left mutated after this pass (verified via
  `git status` and re-diffing against the originals I copied to `/tmp`
  before each mutation, all deleted after use).

## Babashka side — hand-authored sweep found a genuine gap, closed it
- `role-for-observation` in `pipeline_stage_cli.bb` folds seat ids on TWO
  branches (`:sent`'s `to:`-header read, and the `:role role-info` read for
  `:in_process`/`:new`). Hand-mutated each branch independently:
  - Unfolding the `:role role-info` branch only: **killed** by the
    existing BL-1040 shell cases (`the second seat's ticket reports under
    the STAGE`, `the emitted stage map carries no seat id at all`).
  - Unfolding the `:sent` branch only: **SURVIVED** — the entire shell
    suite (`bash swarmforge/scripts/test/test_pipeline_stage_cli.sh`)
    stayed green with that branch's fold removed. No feature scenario or
    property test covered it either (grepped both, no hits).
  - This is not dead code: `swarm_handoff.bb`'s `to:` header is drafted by
    agents and could plausibly carry a seat id once BL-1001
    (difficulty-aware seat routing, paused, named in this ticket's own
    sequencing note) starts routing to specific seats — exactly the
    scenario invariant 1 exists to cover regardless of mailbox state.
  - **Closed**: added a new case to
    `swarmforge/scripts/test/test_pipeline_stage_cli.sh` — a `:sent`-state
    fixture (`wt-cleaner/.swarmforge/handoffs/sent/`) with a
    `to: coder@sonnet2` header, asserting the emitted map folds it onto
    `coder` with no `@` anywhere in the output. Verified against the real
    code (passes) and against the hand-applied mutant (fails), then
    restored the production `.bb` file to its unmutated state before
    committing.
- `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` — ALL CHECKS
  PASSED (including the new case), re-run clean after restoring the
  production file.

## CRAP — found and fixed a real regression
- `node scripts/crapReport.js src/swarm/swarmState.ts
  src/concierge/pipelineBoard.ts` (coverage forced via
  `vitest run --coverage --coverage.reportOnFailure=true`, same
  unrelated-standing-red workaround as above — floor reading only for
  files touched by those reds, not for BL-1040's own files, which have no
  overlap): `heldRoleByTicketId` reported complexity=7, CRAP=7.00,
  exceeding the threshold.
- Differential check against `main`: `git show main:.../pipelineBoard.ts`
  shows the pre-BL-1040 `heldRoleByTicketId` as two plain nested loops,
  complexity 4 — this diff's added per-key fold (a `??`-heavy single pass)
  pushed it to 7, a genuine regression per the differential complexity
  gate, not grandfathered debt.
- **Fixed**: extracted the fold into a new function
  `idsByStageFromRoleHeldTickets`, leaving `heldRoleByTicketId` at its
  original shape. Re-measured: both functions now CRAP=4.00 (matching
  baseline). Re-ran the hand-mutation sweep on the extracted function
  post-refactor to confirm no coverage was lost (killed, same as before
  extraction). Re-ran the full test suite, property test, and acceptance
  feature (6/6) — all still green. `npx jscpd` on both files: 0 clones,
  both before and after the refactor.
- 11 other CRAP>6 functions in these two files are pre-existing debt this
  parcel's diff never touched (confirmed: none of `stageOfSeat`,
  `normaliseBareRoleStage`, `normaliseObjectStage`,
  `idsByStageFromRoleHeldTickets`, or `heldRoleByTicketId` appear in that
  list post-fix) — out of scope per the differential gate.

## Verification (full re-run after the CRAP fix)
- `npm run compile` — clean.
- `npx vitest run test/pipelineBoard.test.js test/state.test.js` — 172/172.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1040SeatIdentityObservationPath.property.test.js` — 4/4.
- `node specs/pipeline/cli.js
  specs/features/BL-1040-seat-identity-never-escapes-on-the-observation-path.feature`
  — 6/6, including the stale-file scenario.
- `bash swarmforge/scripts/test/test_pipeline_stage_cli.sh` — ALL CHECKS
  PASSED (5 BL-1040 cases, including the new one).
- Whole-tree acceptance guard sweep (parcel touches `specs/pipeline/steps/`
  and `extension/test/`): 3 pre-existing failures
  (`tempDirTrapGuard`/`socketFixtureShortRootGuard`/`liveRepoDerivationGuard`,
  tracked BL-1289/1290/1291) — confirmed by grep that none of their
  violation lists name any BL-1040 file.

## Commit hygiene
- `git commit` was refused by `check_property_suite_drift.sh` citing
  `test/bl1030StopFlagTokenBoundary.property.test.js` as non-allowlisted,
  out of 26 failed files in that run. Confirmed this is the known BL-1234
  matcher-misread bug (documented: multiple pre-existing reds trip a
  miscount), not a real regression: that file passes cleanly standalone
  (3/3) and is untouched by this parcel. Used the documented recovery-only
  override (`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1`), named explicitly in
  the commit message per BL-1234's guidance — not treated as routine, and
  not re-minted as a new ticket.
- No orphaned test/mutation/tmux processes left running; all temporary
  Stryker config files and workdirs removed before commit.

## Lessons
No new `rule_proposal` — every trap hit this pass (Stryker blocked by
unrelated reds, the property-suite-guard false rejection, the differential
CRAP regression) is already covered by a standing rule or ticket (BL-1244's
precedent, BL-1234, the differential complexity gate rule).

## Verdict
One real Babashka test-coverage gap found and closed (the `:sent`-branch
seat fold), one real CRAP regression found and fixed
(`heldRoleByTicketId`). Forwarding to documenter.
