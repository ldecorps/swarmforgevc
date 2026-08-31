# BL-1240 — hardener pass, 2026-08-31

Merged architect's tip `bf686b27a1` into hardender. The merge tried to delete
`backlog/hold/BL-1240-...yaml` and `backlog/hold/BL-1253-...yaml`
(content-identical moves to `backlog/active/`) without those tickets in the
commit message; `check_merge_deletion.sh` reported BL-1240's path as
`(unattributed)` — the introducing commit's subject (a plain "Merge main
into architect: ..." bookkeeping commit) names no ticket id, so no commit
message could ever satisfy that check (known trap, see
`check-merge-deletion-guard-unattributed-path-needs-separate-cherry-pick`
memory). Per the established remedy: aborted the merge, cherry-picked the
two "Pre-clear stale hold/ copy" commits (`cf99ad7594` for BL-1240,
`21f5d85b4d` for BL-1253) from the inbound history first, then re-ran the
real merge. That produced two rename/delete conflicts (git detected the
hold->active rename on the incoming side but not on mine, since my side had
already deleted the hold/ copy via cherry-pick); resolved by taking the
incoming `active/` content for both — confirmed content-identical to what
was in `hold/`. Merge commit: `4f846c0355`. Diffed the merge result against
both parents; nothing dropped.

## Ticket context

Two prior bounces on this ticket, both in
`extension/test/helpers/pinnedRepoFixture.js`'s script-closure walker
(`loadFileDeps`/`resolveDepPath`): QA bounced on a `"test"` subdirectory
idiom silently dropping a dependency (regressing
`telegramFrontDeskBotCli.test.js`/`.property.test.js`); architect bounced on
a second idiom, `(fs/path repo-root "swarmforge" "scripts" "x.bb")`, being
misread as a referrer-relative subdirectory instead of the scripts root,
silently dropping `acp_session_lib.bb`, `prompt_engine_lib.bb`,
`cursor_seat_guard_lib.bb`, `front_desk_supervisor_lib.bb`. Given the repeat
failure class (a walker that looked right and wasn't, twice), this pass
went further than re-running the named regressions.

## Runs and checks performed

- `bb swarmforge/scripts/test/unregistered_test_gate_lib_test_runner.bb` ->
  `ALL PASS`.
- `npx vitest run test/pinnedRepoFixture.test.js` -> 16/16 pass.
- Re-ran both regressions QA/architect bounced on directly:
  `telegramFrontDeskBotCli.test.js` -> 271/271 pass;
  `telegramFrontDeskBotCli.property.test.js` (properties config) -> 3/3 pass.
- Re-ran architect's own D1 repro script directly (`cursor_seat_guard_lib_test_runner.bb`
  closure) -> dependency now present.
- **Repo-wide independent sweep** (not requested by the ticket, added this
  pass): built `resolveScriptClosure` vs `copyScriptClosure` for all 376
  real `.bb` files under `swarmforge/scripts/test/` as entrypoints and
  diffed the two — zero silent drops anywhere in the tree, not just the
  four files QA/architect happened to name.
- **Hand mutation probe**: reverted the `SCRIPTS_ROOT_ANCHOR` branch in
  `resolveDepPath` (the exact defect architect's bounce fixed) in place (no
  detached job outstanding at the time), re-ran `pinnedRepoFixture.test.js`
  -> 4 tests failed as expected, confirming the test suite actually kills
  that regression rather than merely happening to pass. Restored the file;
  `git status` confirmed byte-identical to the committed version afterward.
- Acceptance: `run_acceptance.sh` on the BL-1240 feature -> 4/4 pass. No
  `Scenario Outline` in the feature, so BL-113 Gherkin mutation is
  inapplicable (BL-638) — not run, not recorded as a pass.
- `required_wiring` re-verified directly: entry 1
  (`suite-inventory-lib/manifest-name` reached from
  `unregistered_test_gate_lib.bb`) and entry 2 (`bl1240UnregisteredTestFailsAuthorSteps`
  registered in `specs/pipeline/steps/index.js:897`) both present.
- BL-149 cooldown gate on both touched `.bb` files
  (`unregistered_test_gate_lib.bb` age 0.84d, `swarm_handoff.bb` age 0.06d):
  both `skip-cooldown`. No mutation run on either this pass; coverage rests
  on the passing bb suite and acceptance above (Babashka has no wired
  Stryker/CRAP/DRY regardless, per engineering.prompt).
- No `extension/src/*.ts` changed by this ticket — CRAP gate not applicable.
  `pinnedRepoFixture.js` is test infrastructure under `extension/test/helpers/`,
  outside Stryker's `out/**/*.js` scope; covered instead by the unit suite,
  the repo-wide sweep, and the hand-mutation probe above.
- Standing whole-tree guards (this parcel touches `extension/test/`): same 3
  pre-existing failures as the prior BL-1308 pass (tempDirTrapGuard,
  socketFixtureShortRootGuard, liveRepoDerivationGuard), none touching this
  parcel's files — already ticketed as BL-1289/1290/1291 (paused).

## Orphan check

`pgrep -fl 'node --test|stryker'` scoped to this worktree: clean before and
after. `git status --short` clean at handoff (no leaked mkdtemp fixtures).

## Verdict

Clean. No test gaps found. Forwarding to documenter.
