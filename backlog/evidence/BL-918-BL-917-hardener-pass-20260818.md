# BL-918 / BL-917 hardener pass — 2026-08-18

Batch of 2 (Article 2.6): both git_handoffs from architect point at the same
commit `72fc09d8ba` (already an ancestor of this worktree's HEAD before this
session started — no merge needed). Combined hardening pass over the union
of both tickets' changed files.

## BL-918 (extension/src/metrics/leanLedgerCompose.ts,
extension/src/metrics/leanLedgerComposeStall.ts, extension/src/tools/lean-ledger-record.ts)

- Mutation cooldown gate: `run` for all 3 files (quiet at time of gate check,
  well past the 3-day cooldown).
- Fresh `npm run compile`: clean.
- Unit tests (vitest): leanLedger.test.js (19), leanLedgerCompose.test.js
  (31), leanLedgerRecordCli.test.js (7), leanLedgerStore.test.js (12) — all
  green.
- Property tests (`npm run test:properties`, scoped):
  bl918PeriodicSamplesAreNotStalls.property.test.js (2/2),
  leanLedgerInvariants.property.test.js (4/4) — all green, matching
  architect's cited 100/100 + 100/100 runs.
- CRAP: initial run found `composeStallEvents` at complexity=7 (CRAP=7.00,
  over the <=6 gate) — the new `isAttentionSignal` guard in BL-918's diff
  pushed it over. Fixed by extracting the per-telemetry-event attribution
  logic (timestamp parse + window match + ticket match + event build) into a
  new `resolveStallEvent` helper, leaving `composeStallEvents` a thin
  filter+dispatch loop. Re-measured: every function in the 3 files now
  <=6 (composeStallEvents=4, resolveStallEvent=5, all others <=5), 100%
  coverage throughout. Behavior-preserving (hardener's own split, not new
  product behavior) — full targeted suite re-run green after the split.
- DRY (jscpd): 35 clones repo-wide, none touching the changed files, before
  and after the CRAP split — no new duplication introduced.
- Gherkin mutation (BL-113, soft): feature had no prior manifest (first
  hardening pass since BL-918 minted). Ran clean:
  `total=6 completed=6 killed=6 survived=0 errors=0`. Manifest + stamp
  committed to `specs/features/BL-918-periodic-samples-are-not-stalls.feature`.
- Acceptance pre-check (fresh `out/`): 9/9 scenarios green, matching
  architect's evidence.
- Stryker (differential, --mutate scoped to the 3 changed `out/**/*.js`
  files, concurrency=1): the initial (whole-suite, perTest) dry run timed
  out at the default 5-minute ceiling on two separate attempts (host load
  averages observed 4.2-8.8 on 4 cores throughout this pass — several other
  live swarm agent sessions concurrently active). A third attempt with
  `--dryRunTimeoutMinutes 12` was killed by the shell's own 15-minute wall
  clock, still incomplete. Per the office-hours mutation bypass
  (hardender.prompt, operator policy 2026-07-06): DEFERRED to the next quiet
  pass rather than stalling this parcel. No orphaned Stryker/vitest/tmux
  processes left behind (confirmed via `pgrep` after each kill). Targeted
  unit + property + Gherkin-mutation coverage above is the substitute for
  this pass; the parcel is not blocked on it per policy.
- Incidental fix (blocking the Stryker dry run entirely, for every ticket,
  not specific to BL-918): `extension/scripts/ensureStrykerSandboxSiblings.js`
  was missing `specs/` from its sandboxed-sibling list, so
  `test/bl884GherkinMutationRunnerArgValidation.test.js` (a pre-existing,
  unrelated test that spawns
  `specs/pipeline/scripts/run_gherkin_mutation.sh`) failed inside the
  Stryker sandbox with `status 127` instead of the expected `3`, aborting
  the dry run before it could even reach my 3 target files. Added `specs` to
  `SIBLING_NAMES` (mirrors the existing pwa/swarmforge/.github/docs
  pattern) — fixed the harness in my own domain per the BL-788 lesson
  precedent (fix test infrastructure blocking your own gate, in your
  parcel, rather than bouncing it upstream). Confirmed the standalone test
  still passes (3/3) after the fix; no test pins the exact `SIBLING_NAMES`
  list.

## BL-917 (swarmforge/scripts/handoff_lib.bb)

- No mutation/CRAP/DRY tooling for Babashka (engineering.prompt) — gated by
  its own unit-test suite only.
- `swarmforge/scripts/test/test_rotate_recomposes_role_prompt.sh`: 7/7
  scenarios (incl. BL-917's new 05-07) green.
- `swarmforge/scripts/test/bl917_recompose_never_loses_prompt_on_failure_property_runner.bb`:
  200/200 runs, 8/8 role generator coverage — matches architect's evidence.
- Sibling suite `bl911_rotation_recompose_test_runner.bb`: still green
  (no regression from the shared `handoff_lib.bb` edit).
- Acceptance pre-check: `specs/features/BL-911-rotation-recomposes-the-role-prompt.feature`
  10/10 green (extends this feature rather than opening a new one, per the
  ticket's own approval_context).
- Gherkin mutation (BL-113, soft): re-ran to refresh the file-level stamp,
  which had gone stale relative to BL-917's new scenarios 05-07 (the
  architect flagged this and correctly judged it not a defect - BL-917 adds
  no new `Scenario Outline:` rows). Result:
  `total=0 skipped_scenarios=2 skipped_mutations=5` — both existing Outline
  scenarios' own content is unchanged, so soft correctly skipped
  re-mutating them (BL-460: a `total=0` soft-skip is not a broken run). The
  top-of-file `mutation-stamp` was refreshed to match the file's current
  full content (including scenarios 05-07); each scenario's own prior
  `Killed=Total` result and `tested_at` are preserved unchanged. Stale stamp
  now resolved.

## Cleanup

- No orphaned `node --test`/stryker/vitest processes at any point (checked
  before starting and after every kill).
- No fixture tmux servers leaked (this ticket's step handlers use no
  `startBridge`/tmux fixture - BL-788 hazard does not apply).
- Deleted my own scratch `./tmp/bl918-gherkin-work` and
  `./tmp/bl911-gherkin-work` dirs before handoff.

## Forward

Both BL-918 and BL-917 forwarded to documenter as separate `git_handoff`s
(Article 2.6), same task names, this pass's commit.
