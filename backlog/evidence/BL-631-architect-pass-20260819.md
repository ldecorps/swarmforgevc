# BL-631 architect pass — 2026-08-19

## Scope

Received from cleaner as `merge_and_process cleaner 1f25d6e71f`. Two coder
commits: `cf2c2ad96a` (the original implementation, 5 files) and
`fb32c325a3` (the fix for cleaner's own bounce, 1 file — see
`backlog/evidence/BL-631-cleaner-bounce-20260819.md`). This is BL-631's
first time reaching architect, so this pass covers the full parcel, not
just the bounce delta.

Files reviewed (`git show --stat` on both commits):
- `swarmforge/scripts/babysitterd_sweep_lib.bb` (new
  `check-pipeline-code-on-main`, pure, wired into `assemble-findings`)
- `swarmforge/scripts/babysitter_check.bb` (new
  `gather-pipeline-code-on-main`, the impure gatherer; also a pre-existing,
  unrelated `read-dedup-state` keywordize-keys bug fixed in the same
  commit because scenarios 05/06 could not otherwise pass — see below)
- `specs/pipeline/steps/bl631BabysitterDetectsPipelineCodeOnMainSteps.js`
  (new, 17 acceptance scenarios)
- `specs/pipeline/steps/index.js` (+1 registry line)
- `swarmforge/scripts/test/babysitterd_sweep_lib_test_runner.bb` (new pure
  unit coverage + 2 required_wiring proofs)
- `swarmforge/scripts/test/test_babysitter_check.sh` (bounce fix: `make_root()`
  is now git-backed so the new check resolves cleanly instead of failing
  the pre-existing scenario A/E "OK all checks green" assertion)

## Checks run (complete inventory, not first-failure-stop)

1. **required_wiring (3 anchors)** — grepped all three literal anchors
   directly: `pipeline-code-on-main` present in both `babysitter_check.bb`
   and `babysitterd_sweep_lib.bb`; `check_pipeline_code_on_main.sh` present
   in `babysitter_check.bb`. All three confirmed present.
   **Independently re-verified non-vacuous, not just present**: removed
   `pipeline-code-on-main-findings` from `assemble-findings`'s own concat,
   ran `babysitterd_sweep_lib_test_runner.bb` — exactly the two tests
   naming this wiring failed (`an offending commit reaches
   assemble-findings's own output as a CRIT finding`, `an unresolvable
   swarmforge-QA ref reaches assemble-findings's own output as UNAVAILABLE`
   — the BL-419 shape this ticket's own commit message names). Restored
   from an untouched backup, confirmed `git diff` empty, reconfirmed green.
2. **Invariant 1** ("every landing of pipeline work on main outside QA's
   integration path raises a CRIT finding — no role, path, commit shape, or
   timing is exempt"): both `main` and `origin/main` are swept
   (`existing-refs`); merge commits are diffed via `git diff-tree -m
   --first-parent`, never plain `git show`/`diff-tree` (`commit-is-merge?`
   branches on this); ancestry is confirmed per-sha via the shared
   `is_qa_ancestor.sh` predicate after `git rev-list` enumerates
   candidates. Verified via the required_wiring break-test above (item 1)
   and the full acceptance suite (item 4 below), including scenario 10
   which reproduces the 2026-07-25 BL-590 incident's structural shape (6
   individual offenders + 1 merge + 2 false-positive-shaped clean commits).
3. **Invariant 2** ("the QA-exclusive path set has exactly ONE definition,
   BL-632's `check_pipeline_code_on_main.sh --list-paths` — never a second
   copy, in any language"): `qa-exclusive-paths` shells the script with
   `--list-paths` at runtime (env-seam override for tests, never a
   hardcoded fallback list). **Independently verified**: ran
   `bash swarmforge/scripts/check_pipeline_code_on_main.sh --list-paths`
   directly — prints the 3 canonical paths, exit 0. Grepped both new `.bb`
   files for `extension/src`, `extension/test`, `specs/pipeline/steps` —
   zero hits; no restated literal anywhere in production code.
4. **Invariant 3** ("a check that cannot determine ancestry reports
   UNAVAILABLE, never a clean sweep"): every failure branch in
   `gather-pipeline-code-on-main` (unreadable path script, unresolvable
   `swarmforge-QA`, either ref's `rev-list` failing, any single sha's
   ancestor-confirmation failing) returns `:ancestry-unavailable? true`;
   the caller additionally wraps the whole call in `try/catch` to the same
   fail-closed shape for a genuinely unexpected exception. Covered by the
   required_wiring break-test above (item 1, which independently exercises
   the pure `check-pipeline-code-on-main` UNAVAILABLE branch) and by
   acceptance scenario 08 (full impure chain, unresolvable ref).
5. **Dependency-rule gate (BL-259 hard gate)** — ran per-parcel against the
   one JS file in the diff
   (`bl631BabysitterDetectsPipelineCodeOnMainSteps.js`): PASSED, no
   forbidden edges. `index.js` alone reproduces the same pre-existing,
   already-tracked `acyclic` violation
   (`telegram-front-desk-bot.ts`/`telegramCursorOperatorExec.ts`/
   `telegramCursorOperatorLiveness.ts`, `backlog/paused/BL-759-...yaml`)
   independently confirmed unrelated during today's BL-944 pass — same
   reasoning applies verbatim here, not this parcel's defect.
6. **Co-change report (BL-255)** — ran against all 5 non-registry changed
   files. All SUSPECTED COUPLING hits are among `babysitter_check.bb`,
   `babysitterd_sweep_lib.bb`, their own test runner, and `index.js` — the
   same cluster of files this ticket's own description says to mirror
   (`scan-claim-risks`/`check-claim-risk`'s existing shape: gatherer + pure
   check + test runner, touched together exactly as every other check in
   this file already is). Expected, intra-subsystem coupling from the
   chosen (and ticket-endorsed) design, not new or concerning.
7. **Fixture/tmux-server discipline** — the step handler tracks every
   `mkTmp()` root AND every fake-coordinator tmux socket in module-level
   arrays (`trackedRoots`, `trackedSockets`), torn down in one `afterEach`
   (sockets killed first, then roots removed) — confirmed by reading the
   file, not just the commit message. **Independently re-verified live**:
   `sfvc-bl631-*` dir count was 0 before and 0 after a fresh 17-scenario
   run; `ps aux | grep sfvc-bl631` found zero lingering tmux server
   processes afterward.
8. **The pre-existing, unrelated `read-dedup-state` keywordize-keys bug**
   (fixed in the same commit because scenarios 05/06 cannot pass against
   it) — confirmed correctly scoped: `grep -rn read-dedup-state
   swarmforge/scripts/` shows the one call site this fix touches; the
   coder's own commit message documents why deferring it to a separate
   surfaced-defect note (the BL-937/817 precedent) was NOT appropriate
   here — it blocks this ticket's own declared acceptance criteria
   directly, unlike an adjacent-but-independent finding. Correct
   disposition, not scope creep.
9. **Property Testing pass** — no new pure JS/TS module in this parcel
   (the step handler is fixture/IO-driving; the new pure logic is
   `check-pipeline-code-on-main`/`offending-paths`, both Babashka). Per the
   established carve-out (Babashka has no fast-check equivalent wired in
   this repo, already applied at this session's BL-924/BL-938/BL-923
   passes), no property-test obligation here — correctly not attempted.
10. **Module boundaries / two-layer architecture** — not implicated: no
    `extension/src/` or webview file touched, no secrets, no webview
    storage, no process spawned bypassing tmux (this is the babysitter
    daemon's own deterministic-check layer, not the tile/tmux substrate).
11. **The bounce fix itself (D1)** — `test_babysitter_check.sh`'s
    `make_root()` now git-inits a minimal repo (`main`, empty commit,
    `swarmforge-QA` branch pointing at the same commit) so the new check
    resolves and reads genuinely clean rather than merely available,
    exactly the remediation the cleaner's own bounce evidence pointed to.
    **Independently re-ran the cleaner's full bounce checklist myself**:
    all 9 `test_babysitter_check.sh` scenarios (A-I) pass (was failing at
    A), all 4 `babysitter*_test_runner.bb` suites pass,
    `test_babysitterd_lifecycle.sh` 8/8 pass, the BL-631 acceptance feature
    17/17 pass, `tsc -p ./` clean compile.

## Verdict

No architecture violation, no correctness defect found. All three declared
invariants independently re-verified, including by forcing the
required_wiring gate to fail by hand. The cleaner's own bounce (D1,
integration) is fixed and independently re-verified against the cleaner's
own full checklist. The pre-existing `acyclic` violation the dependency-
gate reports is unrelated and already tracked (BL-759). Forwarding to
hardener.

By architect.
