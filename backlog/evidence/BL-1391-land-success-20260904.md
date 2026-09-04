# BL-1391 — LAND SUCCESS, 2026-09-04

The reconcile sweep's `merge-tree` verdict `:conflict` now resolves instead
of refusing when a conflict is confined to append-only bookkeeping paths
(ticket YAML under `backlog/`, `backlog/topics/*.json`,
`backlog/evidence/*.md`, `backlog/answers-archive/*.md`,
`docs/briefings/**`) and every conflicted hunk is append-only on both
sides — a real merge commit through the same `absorb-with-merge!` guard
chain, keeping both sides' additions ours-then-theirs. A mixed conflict
with any non-bookkeeping path, or any rewrite/deletion, still refuses
exactly as before.

## Bounce and rework (prior to this pass)

Bounced once for intermittent e2e flakiness directly falsifying invariant
3. Reworked by coder, re-reviewed by architect (confirmed non-flaky over
19+ consecutive clean runs — `BL-1391-architect-pass2-20260904.md`),
re-hardened, re-documented. Full chain re-verified via ancestry
(`git merge-base --is-ancestor`) before this pass: coder rework
(`0eb4be2649`), cleaner (`d119daac0e`), architect re-review (`3b8bebf01b`),
hardener (`2fbbe9effb`), documenter (`3e33f1e083`) all confirmed ancestors
of the merged tip (`f71bcbe4a0`).

## Verification (this pass, QA worktree, merged documenter tip)

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1391_bookkeeping_conflict.sh` —
  14/14 PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/bl1391_bookkeeping_conflict_property_runner.bb`
  — ALL PROPERTIES HOLD (515 constructed cases).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1391's feature — 6/6
  (4 plain `Scenario` + 1 `Scenario Outline` with 2 examples = 6 runnable,
  matching the feature file's own count exactly).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- Both `required_wiring` anchors confirmed present by grep:
  `bookkeeping-conflict` (handoffd.bb's log label, both refused and
  resolved paths), `registerSteps` (BL-1371).
- `node extension/out/tools/qa-sibling-check.js status --ticket BL-1391` —
  `VERIFY BL-1391`, no open deferral.
- No `extension/src` touched — CRAP/DRY N/A.
- Hardener's BL-149 cooldown gate: skip-cooldown (file actively churning
  this session) — no fresh hand-authored mutation sweep required this
  pass; existing unit/property/e2e(4x)/acceptance(3x) coverage stands,
  independently re-run here.
- BL-113 Gherkin mutation (hardener, re-confirmed against the feature
  file's own embedded manifest per BL-460): 4/4 killed, 0 survived.
- No orphaned test/mutation processes before or after.

## Byproduct: independently re-fixed the same handoffd.bb defect

This ticket's own real-daemon-tick e2e independently found and fixed the
same `read-json`/forward-reference defect this session's BL-1390 land
already fixed (root cause: this session's earlier BL-1392 land). Hardener
took THIS chain's version over the equivalent BL-1390/1392 fix already on
`main` — functionally equivalent, but adds an explicit `fs/exists?` guard
ahead of `slurp` rather than relying on the exception path for the common
"no state file yet" case, with a fuller comment on the SCI eager-analysis
placement constraint. Re-confirmed on the pure tree: `timeout 10 bb
swarmforge/scripts/handoffd.bb` reaches the `Usage:` line cleanly, no
analysis error.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1391`. Origin/main had already
advanced past this session's BL-1390 land (`340530ab85`) by the time this
land started — the master checkout's own reconcile absorbed origin/main
and closed BL-1390 (`5a06d9ed01` "Absorb origin/main into main so the
daemon can run the BL-1390 land that carries the read-json fix", `7399f5c9be`
"Close BL-1390: move to done", plus BL-1395/1398/1399 minting/promotion/
approval commits) and pushed that forward to `82848d82d8` — confirmed via
`git worktree add origin/main` picking up the already-advanced tip
directly, so this land's single commit sits cleanly on top with no
rematch needed.

Own paths: the 8 BL-1391-named files (ticket yaml, 7 evidence files, how-to
extension folded into `docs/index.md`'s existing BL-891 line, feature file,
step handler, property runner, e2e suite) plus `handoffd.bb` and
`master_main_reconcile_lib.bb`/its test runner (single-hunk diffs each,
verified via `git diff origin/main HEAD -- <file> | grep -c '^@@'`, all
legitimate BL-1391 content — no unrelated ticket's content present in this
diff at land time). `docs/index.md` needed a single-line modification
(extending the existing BL-891 how-to entry, not a new row) — verified the
"old" side of the diff matched the scratch tree's current line exactly
before replacing. `docs/reference/Specification.MD` needed the ticket's
own entry prepended as the new top-of-stack (above BL-1390's, this
session's prior land), keeping the `Prior entry —` chain intact.
`swarmforge/scripts/test/suite-manifest.tsv` needed one new row
(`test_bl1391_bookkeeping_conflict.sh`) appended in the file's existing
tab format.

Caught and fixed one accidental mode change before committing (repeat of
the same class of mistake made during BL-1390's land): a blanket `chmod
+x` incorrectly flipped `master_main_reconcile_lib.bb` from `100644` to
executable — reverted with `chmod -x` before staging; confirmed no
mode-change lines in the final commit's diffstat.

Excluded: two unrelated mode-only changes present in the QA-tip's raw
diff against origin/main (`bl1381_shift_schedule_mutation_sweep.sh`,
`test_handoffd_expedite_park_reversal_wiring.sh` — both `100644` →
`100755` with zero content change, unrelated to BL-1391, artifacts of
shared-worktree history).

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `timeout 10 bb swarmforge/scripts/handoffd.bb` — reaches `Usage:`
  cleanly, no analysis error (the boot-level proof this session's BL-1390
  land also required).
- `bash swarmforge/scripts/test/test_bl1391_bookkeeping_conflict.sh` —
  14/14 PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/bl1391_bookkeeping_conflict_property_runner.bb`
  — ALL PROPERTIES HOLD.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1391's feature — 6/6.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- Both `required_wiring` anchors re-confirmed present by grep.
- `git diff --diff-filter=D origin/main --cached` — no deletions.
- No orphaned test/mutation processes before or after.

## Landed

- Tip-pure commit `72f66b3d7e` off `origin/main` at `82848d82d8`.
- `land_main_publish.sh --decide-only` (lock not held during the decision
  call) read `:lock-admission :admit`, `:next :push`,
  `origin-advanced-since-gate: false`. Acquired the lock, pushed
  `82848d82d8..72f66b3d7e`, verified with `git ls-remote origin main`,
  released the lock.
- No `abandoned_commits` follow-up: hand-built directly, no
  `land_step_cli.bb` attempt was run.
- Scratch worktree `/tmp/land-bl1391` removed after confirmed push.

## Not a GH-seeded ticket

`BL-1391`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
