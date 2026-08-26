# BL-640-constitution-reference-amendments-have-no-delivery — QA bounce

QA ran the full review inventory (Article 4.4 — complete pass, one bounce).
Parcel received: `merge_and_process documenter 9633128f0c` (documenter's
doc pass, forwarding hardener's `388097883`, architect's round-2
`07a8ff93e`, and coder's original `fded1ca02` + bounce-fix `5a8c134cc`
unchanged). Merged into QA's worktree as `7766b2643`.

## D1 — behavior: `bl640_prompt_stability_check.bb` leaks two temp
directories every run, failing the repo's own `tempDirTrapGuard.test.js`
gate deterministically

1. **Failing command**: `cd extension && npx vitest run
   test/tempDirTrapGuard.test.js` (also surfaces inside the full
   `npm test` run).
2. **Commit hash tested**: `7766b2643` (QA's merge of documenter's
   `9633128f0c`; the defect itself originates in coder's original commit
   `fded1ca02` and was never touched by the later bounce-fix, architect
   round-2, or hardener commits).
3. **First error excerpt**:
   ```
   FAIL  test/tempDirTrapGuard.test.js > the real swarmforge/scripts tree has zero temp-dir-trap violations
   AssertionError: expected zero temp-dir-trap violations under swarmforge/scripts, found:
   /Users/ldecorps/projects/swarmforgevc/.worktrees/QA/swarmforge/scripts/test/bl640_prompt_stability_check.bb: creates a temp root (fs/create-temp-dir) but has no shutdown hook and no try/finally delete-tree
   ```
4. **Failure class**: `behavior` (a resource-leak defect in shipped test
   code, not a spec gap — `tempDirTrapGuard.test.js` is a pre-existing,
   already-loaded repo-wide gate this ticket's own new file trips).
5. **Expected vs observed**: expected zero temp-dir-trap violations under
   `swarmforge/scripts`; observed one, in this ticket's own new file.

**Root cause**: `swarmforge/scripts/test/bl640_prompt_stability_check.bb`'s
`mk-synthetic-root` (lines 31-42) calls `(fs/create-temp-dir {:prefix
"bl640-prompt-stability-"})` and is itself called twice (scenario 04 and
scenario 06), each creating a real temp directory tree. Neither call site,
nor the file as a whole, registers a JVM shutdown hook or wraps its usage in
a `try`/`finally` that deletes the tree — confirmed by grepping the file for
`delete-tree`/`finally`/shutdown-hook patterns: zero matches outside the
single `create-temp-dir` call. Every run of this script (already run
independently at least 3 times across the coder, architect-round-2, and
hardener passes, per their own evidence files) leaks two more directories
under the OS temp root. This is exactly the class of defect
`engineering.prompt`'s Test Speed And Isolation rule and
`tempDirTrapGuard.test.js` exist to catch (constitution: "A fixture dir ...
is removed in a `finally`, never only after the last assertion").

**Not a flake**: re-ran `npx vitest run test/tempDirTrapGuard.test.js` in
isolation (no other test/vitest process running, confirmed via `pgrep`)
and it failed identically and deterministically — this is independent of
the host's current load, unlike two other unit/property failures observed
this same QA pass (see below, both confirmed flakes and excluded from this
bounce).

**Owning role**: **coder** — `bl640_prompt_stability_check.bb` is coder's
own file (`fded1ca02`, untouched by every later stage), and this is an
ordinary implementation defect (missing cleanup) in that file, not a
docs/architecture/mutation-coverage concern.

**Remediation pointer**: wrap each `mk-synthetic-root` caller's usage in
`try`/`finally` deleting the returned root with `fs/delete-tree`, matching
this repo's other `.bb` test fixtures that already follow this pattern
(e.g. `test_reference_freshness_guard.sh`'s `register_tmp_dir` EXIT-trap
registry, cited approvingly in this same ticket's own architect round-2
evidence for its own new fixtures). Verify with `npx vitest run
test/tempDirTrapGuard.test.js` green, then re-run
`bl640_prompt_stability_check.bb` directly and confirm no residual temp
dir remains under `$TMPDIR` after a normal exit.

## Other failures observed this pass — investigated and excluded (not this
ticket's defect, not part of this bounce)

- `test/renderBriefingBurndownCli.test.js` (`falls back to deriving its own
  history when no snapshot path is given (smoke test against the real
  repo)`): failed inside the full `npm test` run with `Test timed out in
  20000ms`. Re-ran the whole file in isolation (host load ~32 at the time
  of the full run) — all 5 tests in the file passed cleanly in 14.5s total,
  the named test itself in 4.9s. BL-640 touches nothing related to
  briefing/burndown rendering. Confirmed host-load flake, not bounced.
- `test/bl632CommitTimeGuardInvariants.property.test.js` (`property
  (invariant): no non-QA commit, merge, or amend path lands pipeline code
  on main`): failed inside the full `npm run test:properties` run with
  `Test timed out in 90000ms`. Re-ran the file in isolation — passed
  cleanly. BL-640 touches nothing related to BL-632's commit-time guard.
  Confirmed host-load flake, not bounced.
- Suite-duration/per-file budget guard nonzero exit on the full `npm test`
  run (245-280s vs a 10s suite budget; 20-25 files over their per-file
  budget): none of the over-budget files are part of BL-640's diff (which
  touches only `swarmforge/scripts/*.bb`, `specs/pipeline/steps/*.js`,
  docs, and backlog YAML). Host load measured 12-34 across this pass
  (`uptime`), consistent with the hardener's own recorded observation on
  this same ticket (load_avg 26.21, busy_threshold 2.00x on 4 cores).
  Environmental, not bounced.

## Everything else re-verified this pass — green, complete inventory

- `bash swarmforge/scripts/test/test_reference_freshness_guard.sh` — ALL
  PASS, run twice consecutively.
- `bb swarmforge/scripts/test/reference_freshness_lib_test_runner.bb` — ALL
  PASS.
- `bb swarmforge/scripts/test/bl640_reference_freshness_property_runner.bb`
  — ok.
- `bb swarmforge/scripts/test/bl640_prompt_stability_check.bb` — ok (both
  scenarios pass; the script's own assertions are correct, only its
  fixture cleanup is missing — D1 above).
- `node specs/pipeline/cli.js
  specs/features/BL-640-constitution-reference-amendments-have-no-delivery.feature`
  — 5/5 PASS.
- Wiring: `enforce-reference-freshness-guard!` confirmed called
  unconditionally at `ready_for_next.bb` load time (before
  `dispatch-lib/run-dispatch!`), the real entry point every role uses —
  not merely unit-tested in isolation.
- Ancestry: `fded1ca02`, `5a8c134cc`, `07a8ff93e`, `388097883`,
  `9633128f0` all confirmed ancestors of the tested commit `7766b2643`.
- Documentation: how-to runbook, handoff-protocol.md reference section,
  Specification.MD changelog all present and landed in `9633128f0`.
- No orphaned `node --test`/`vitest`/`stryker` processes before or after
  this pass (`pgrep` checked before and after every run).

Only D1 blocks approval. Everything else in this parcel is sound.

By QA.
