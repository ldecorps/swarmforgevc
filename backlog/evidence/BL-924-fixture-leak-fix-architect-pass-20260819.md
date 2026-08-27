# BL-924 architect pass (fixture-leak bounce fix) — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner babf434a5a`. Coder's own
commit `5fc13dd79b` ("BL-924: fixture-leak cleanup fix", By coder.); cleaner
forwarded unchanged. This fixes my own prior architect bounce recorded in
`backlog/evidence/BL-924-bounce-20260819.md` (D1: the new acceptance step
handler leaked its fixture git repo + nested worktree every run — 32
accumulated `sfvc-bl924-root-*` dirs, each a full disposable repo).

Files touched by the fix (`git show --stat 5fc13dd79b`):
- `specs/pipeline/steps/bl924HotSyncedCopiesDoNotBlockMergeSteps.js` (only
  file — 22 insertions, 1 deletion)

Confirmed no production logic changed since my prior full review: `git diff
576f466b28 5fc13dd79b -- swarmforge/scripts/untracked_collision_clear_lib.bb
swarmforge/scripts/clear_identical_untracked_and_merge.bb` is empty — both
declared invariants stand as already verified (including the non-vacuity
check I ran by hand last pass), so this pass covers only the fixture-hygiene
fix.

## Checks run (complete inventory, not first-failure-stop)

1. **Remediation matches the bounce's own pointer** — the bounce's pointer
   named the `bl413StaleSandboxSweepSteps.js` per-terminal-step
   `try/finally` shape as one valid option, but the coder used a
   centralized-`afterEach` shape instead (`const { afterEach } =
   require('node:test')`; every `mkTmp()` root is pushed to a module-level
   `trackedRoots` array, and `afterEach` pops and `rmSync`s each one). The
   bounce's remediation was a shape suggestion, not a mandate — the file's
   own comment names this as matching the precedent this session already
   established in `bl631BabysitterDetectsPipelineCodeOnMainSteps.js`,
   `bl915CursorBridgeGoneAgentSessionResetSteps.js`, and
   `bl938AgedNoteRotateFixtureRotationRouterSteps.js` — confirmed by grep,
   all three already use the identical `afterEach`-from-`node:test` shape.
   Consistent with established precedent, not a novel pattern to vet from
   scratch.
2. **Every fixture root is tracked** — `mkTmp()` is the only function that
   calls `fs.mkdtempSync`, and it unconditionally pushes the new root before
   returning it; `mkRepoWithDivergedRole()` (the Background, the only fixture
   builder in the file) calls `mkTmp()` exactly once for `root` and derives
   `wt` via `git worktree add` nested under `root` — so removing `root` alone
   takes `wt` with it, exactly as the bounce's remediation note said was
   sufficient. Read the whole file, not just the diff hunk: no second
   `mkdtempSync`/`mkdirSync(os.tmpdir()...)` call site exists anywhere else
   in it.
3. **`afterEach` runs on throw, not only on pass** — this is the part of the
   bounce that actually matters (a `finally`-shaped guarantee, not a
   happy-path cleanup). Independently verified by forcing a failure, not by
   reading `node:test`'s docs: temporarily inserted `throw new
   Error('FORCED_TEST_FAILURE...')` at the top of scenario 01's terminal
   assertion step, re-ran the suite (1 fail as expected), confirmed the
   fixture-dir count was still 0 after the run, then restored the file from
   an untouched backup and confirmed `git diff` was empty.
4. **Dependency-rule gate (BL-259 hard gate)** — `dependency-gate.js`
   against the one changed file: N/A, same structural reason as every prior
   pass on non-`extension/src/` files (depcruise's scan root is
   `extension/`; ran from `extension/` with a relative path to confirm it
   actually executes rather than silently no-op'ing — "Dependency-rule gate
   PASSED: no forbidden edges").
5. **Co-change coupling (BL-255)** — `co-change-report.js` against the
   changed file: 5 co-changes, all at frequency 1 (its own feature's step
   registry entry, the production lib, its two test runners) — all below the
   tool's suspected-coupling threshold (3). Same zero-coupling result as my
   prior pass; nothing new introduced by this fix.
6. **No production code touched** — this is a test-infrastructure-only fix;
   the two-layer boundary, host-IO-ownership, webview-storage, secrets, and
   integrate-not-fork checks are not applicable (no `extension/` or
   `swarmforge/scripts/` production file in this diff).
7. **Property Testing pass** — not applicable to this diff (a JS acceptance
   step handler driving real git fixtures via side effects, not a pure
   module); the underlying pure `swarmforge/scripts/untracked_collision_clear_lib.bb`
   is unchanged from my prior pass, where the property-test carve-out
   (Babashka has no fast-check equivalent wired) already applied.

## Verification (independent re-run, not just inspection)

- `node specs/pipeline/cli.js specs/features/BL-924-hot-synced-untracked-copies-block-fast-forward.feature`
  → 4/4 scenarios PASS.
- Fixture-leak check: `ls $TMPDIR | grep -c sfvc-bl924-root-` measured 0
  before the run and 0 immediately after — the leak is gone, not merely
  reduced (prior bounce measured 32 accumulated dirs before this fix).
- Forced-failure re-run (see item 3 above): 1 scenario failed as forced, and
  the leaked-dir count was still 0 afterward — `afterEach` fires on the
  throw path, confirmed rather than assumed.

## Verdict

No architecture violation, no correctness defect found. The bounced
fixture-leak defect (D1, my own 2026-08-19 bounce) is fixed and
independently re-verified, including under a forced-failure path. Both
declared invariants stand unchanged from my prior full review (production
logic untouched by this fix). Forwarding to hardener.

By architect.
