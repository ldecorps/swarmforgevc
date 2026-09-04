# BL-1379 — LAND SUCCESS, 2026-09-04

Same class as this session's BL-1386/BL-1387/BL-1381 lands.
`land_step_cli.bb BL-1379-... <HEAD>` printed `LAND_ESCALATE`: "could not
create worktree ... off origin/main" — retried once, same result, then
diagnosed the entangled-sibling list as the known 27-ticket inflation class
(most already landed per content, matching `LANDED_SIBLING` lines from this
session's earlier runs). Per the specifier's adjudication
(`backlog/evidence/BL-1386-land-escalate-adjudication-20260904.md`, "this
adjudication covers the CLASS"), hand-built instead of re-escalating.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1379`, off `origin/main` at
`353f998099` (the tip left by this session's BL-1381 land). Own-paths (24
files) from the coder/cleaner/architect(x2)/hardener/documenter evidence
trail, cross-checked against `git diff --name-only origin/main <QA-tip
53f9b8cfd6>`. That raw diff carried, in addition to BL-1379's own content:

- BL-1367's six exclusive files (still unlanded).
- BL-1385's ENTIRE feature this time (its ticket/evidence files, feature
  file, step handler, CLI, mutation sweep, `check_handler_module_graph.sh`
  itself, and its wiring into `run_commit_guards.sh`/`land_step_lib.bb`) —
  BL-1385 is bounced (`backlog/evidence/BL-1385-bounce-20260904.md`), and
  this worktree still carries its full unlanded work. Verified line-by-line
  that `run_commit_guards.sh` and `land_step_lib.bb`'s diffs were 100%
  BL-1385 additions (grepped for "BL-1385" in each diff) before excluding
  them wholesale rather than attempting a splice.
- ~15 other tickets' `backlog/evidence/*-land-success-*.md` /
  `backlog/done/**` files — all already-landed content (spot-checked
  `backlog/done/M8/BL-1342-...yaml` present on `origin/main`) or QA's own
  historical bookkeeping for already-landed siblings, kept per BL-1315
  (untagged rides).

`docs/index.md` and `docs/reference/Specification.MD` line-spliced (both
shared, append-only); dropped the BL-1367/BL-1252/BL-1371(BL-1385-edit)
lines, kept only BL-1379's own two `docs/index.md` line extensions and its
own top-of-stack `Specification.MD` entry.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bb swarmforge/scripts/test/expedite_lib_test_runner.bb` — ALL PASS.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1379's feature — 9/9.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-567's (amended) feature
  — 20/20 (scenario 18 correctly retired, not reworded).
- `bash swarmforge/scripts/test/test_handoffd_expedite_park_reversal_wiring.sh`
  — ALL PASS (5/5), including the real-daemon wiring check confirming
  `expedite-park-reversal-sweep!` actually reaches `expedite_cli.bb`'s
  `unpark` subcommand — not merely unit-tested in isolation (the D1 bounce
  this ticket carries: BL-1379's own title claimed self-reversal but
  nothing called it until the coder's fix).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `git diff --diff-filter=D origin/main --cached` — empty.

## Landed

- Tip-pure commit `108517e9f7` off `origin/main` at `353f998099`. Both
  `land_main_publish.sh --decide-only` calls read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `353f998099..108517e9f7`.
- No `abandoned_commits` follow-up: the automated `land_step_cli.bb`
  attempt never produced a replay branch/commit (it `LAND_ESCALATE`d before
  building one), so there is nothing to mark abandoned.
- Neither push carried any BL-1367 or BL-1385 content — confirmed by the
  24-file own-paths list, not by trusting the tool.
- Push went through `land_main_publish.sh --acquire-lock` / `--decide-only`
  / `--release-lock` (BL-1144 discipline), run from the scratch worktree
  holding the candidate commit.
- Scratch worktree `/tmp/land-bl1379` removed after push.

## Not a GH-seeded ticket

`BL-1379`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
