# BL-1381 — LAND SUCCESS, 2026-09-04

Same class as this session's BL-1386/BL-1387 land: `land_step_cli.bb`'s
automated replay (`b441139c44`) bundled BL-1385's three how-to doc edits
(`docs/how-to/BL-1241-...md`, `BL-1252-...md`, `BL-1371-...md` — bounced back
to cleaner this session, `backlog/evidence/BL-1385-bounce-20260904.md`)
alongside BL-1381's own 17 files. Per the specifier's adjudication
(`backlog/evidence/BL-1386-land-escalate-adjudication-20260904.md`, "this
adjudication covers the CLASS"), applied the same hand-build route without a
new escalation note.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1381`, off `origin/main` at
`ef78aa9116` (the tip left by this session's BL-1386/BL-1387 land). Own-paths
(17 files) from the coder/cleaner/architect/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
af426cd3f4>`. `docs/index.md` and `docs/reference/Specification.MD` line-
spliced (both shared, append-only); dropped the BL-1385 doc-edit lines and
the foreign `BL-1367`/`BL-1252`/`BL-1371` index.md lines, kept only the
`BL-1162` line's own extension.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bb swarmforge/scripts/test/swarm_shift_lib_test_runner.bb` — ALL TESTS
  PASSED (confirms the standing BL-660 red is fixed on the pure tree, not
  merely in this worktree).
- `bash swarmforge/scripts/test/test_shift_schedule_applier.sh` — 9/9 (all
  five BL-1381-specific checks plus the three pre-existing smoke checks).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1381's feature — 6/6.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — empty (nothing
  origin/main had went missing).

## Landed

- Tip-pure commit `62afec27b7` off `origin/main` at `ef78aa9116`. Both
  `land_main_publish.sh --decide-only` calls read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `ef78aa9116..62afec27b7`.
- Follow-up commit `353f998099`: appended `b441139c44` (the refused
  automated replay) to BL-1381's existing `abandoned_commits` list. Pushed
  `62afec27b7..353f998099`.
- Neither push carried any BL-1385 content — confirmed by the 17-file
  own-paths list, not by trusting the tool.
- Both pushes went through `land_main_publish.sh --acquire-lock` /
  `--decide-only` / `--release-lock` (BL-1144 discipline), run from the
  scratch worktree holding the candidate commit.
- Scratch worktree `/tmp/land-bl1381` removed after the second push.

## Not a GH-seeded ticket

`BL-1381`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
