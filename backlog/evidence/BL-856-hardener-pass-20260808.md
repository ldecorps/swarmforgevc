# BL-856 failed-integrity-commit-leaves-work-staged — hardener pass — 20260808

Commit reviewed: `7d631f1395` (architect's re-pass forward, "D1 fixed, clean"),
received as `merge_and_process architect 7d631f1395`, merged into this branch
before any check below was run. First time this ticket has reached hardener.

## BL-149 cooldown gate (per changed production file)

- `swarmforge/scripts/commit_integrity_lib.bb` — `run` (file age 22.68d,
  load_avg 4.73/4 cores, quiet). Mutation-eligible this pass.
- `swarmforge/scripts/commit_integrity_cli.bb` — `skip-cooldown` (file age
  1.41d, inside the 3-day cooldown window). Deferred to a later quiet pass;
  the CLI is still actively churning (it gained the D1 step-scoping fix and
  the earlier bounce/re-pass cycle only 1-2 days ago). Not skipped for load.
- `specs/pipeline/steps/bl856FailedCommitMustNotLeaveWorkStagedSteps.js` —
  `run` (quiet host). Mutation-eligible via the Gherkin acceptance route
  below (this file lives outside `extension/`, so Stryker's scope never
  covers it — the acceptance-mutation route is its real gate).

## `.bb` toolchain — engineering.prompt's documented gap (BL-472)

No mutation/CRAP/DRY tool is wired for `.bb`. Per that documented gap, the
real gate is the file's own unit-test suite. Ran:

- `bb swarmforge/scripts/test/commit_integrity_lib_test_runner.bb` — ALL
  TESTS PASSED (35 assertions across caller-shape validation, `:no-git-dir`
  short-circuit, lock-acquire/release on every path including the bounded
  `acquire-lock!` give-up case, `:add-failed`/`:commit-failed` short-circuits,
  verify+retry with injected seams, a real uncontended end-to-end commit,
  real-git pathspec-scoping, a real `git mv` shape, and all six of BL-856's
  own scenarios — restore-on-failure, pathspec-scoped restore, pre-staged
  rename survival, loud `:index-left-dirty`, unchanged success path, and the
  full unrelated-writer end-to-end harm reproduction).
- `bash swarmforge/scripts/test/test_commit_integrity_cli.sh` — ALL PASS
  (5/5, including the close-guard-rejection case).

**Manual coverage-gap read of `commit_integrity_lib.bb`** (283 lines) against
the 475-line test runner, since no coverage tool exists for `.bb`: every
branch in `commit-with-integrity!` has a corresponding assertion —
caller-shape throws, `:no-git-dir` short-circuit (with `add-fn!` proven never
called), bounded lock timeout (both the seam-injected and the real
`acquire-lock!` give-up case), `:add-failed`/`:commit-failed` short-circuits
before verify, the mismatch/retry loop (mismatch-then-match,
retries-exhausted, multi-path partial-mismatch), both snapshot points
(pre-add for `:add-failed`/`:commit-failed`, post-commit for
`:verify-mismatch` — with a dedicated regression test proving the two must
stay distinct, using the REAL default add/commit so a fake-seam test could
not have caught it), restore itself (pathspec-scoped, git-mv-survives,
loud-on-restore-failure, real-restore-succeeds-so-no-false-positive), and the
short-circuits that must never call restore at all (`:lock-timeout`). No
branch, `:reason` value, or declared invariant found without a direct test.
Nothing added — the coder's own self-review (ticket `notes:`) already
reached this conclusion and this pass independently confirms it.

## Gherkin acceptance mutation (BL-113), soft

Feature `specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`
has one `Scenario Outline` (the four `<reason>` failure-class examples); the
other five scenarios are plain `Scenario:` (nothing to mutate per
hardener.prompt).

`bash specs/pipeline/scripts/run_gherkin_mutation.sh specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`
(soft, default level): **4/4 killed, 0 survived, 0 errors.** Every mutated
`<reason>` value produced a real "no step handler matched" failure — the
Outline's example values are genuinely load-bearing, not passthrough. The
tool wrote its stamp + manifest into the feature file (`mutation-stamp`,
`acceptance-mutation-manifest-*`) as part of a normal soft run.

## Verification

- `bash specs/pipeline/scripts/run_acceptance.sh specs/features/BL-856-failed-commit-must-not-leave-work-staged.feature`
  (re-run after the mutation pass, on the clean/unmutated tree): 9/9 green.
- No TypeScript changed by this ticket (pure `.bb` plus one plain-JS step
  file outside `extension/`) — no `extension/` suite re-run needed; the
  ticket carries no CRAP/DRY-scoped files (`crapReport.js`/jscpd both scope
  to `extension/src` — N/A here).
- No orphaned `node --test`/`stryker` processes and no leaked fixture tmux
  servers before or after this pass (`pgrep -fl 'node --test|stryker'`,
  `pgrep -afl tmux` — only the live swarm's own coder session socket).

## Verdict

Clean. No new tests added — coverage was already complete going in, and the
one new mutation gate (Gherkin, BL-113) killed everything. Forwarding to
documenter.
