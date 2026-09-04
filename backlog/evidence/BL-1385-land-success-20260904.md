# BL-1385 — LAND SUCCESS, 2026-09-04

Resumed via documenter's forward (`ee0e129a6b`) after the bounce
(`backlog/evidence/BL-1385-bounce-20260904.md`). Confirmed the full remaining
chain ran this time: cleaner (`10f38c7fa9`), architect (`cd490cb73a`),
hardener governed pass (`1ee168e20c` — "re-anchored the stale mutation-sweep
mutant flagged by cleaner and architect... full sweep now 9/9 killed, 0
skipped"), documenter governed pass (`5f120b8005` — NONE, doc already
accurate).

## Re-verification

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/bl1385_handler_module_graph_mutation_sweep.sh`
  — 9/9 killed, 0 survived, 0 skipped (confirms the bounce's own finding —
  the `out/->src/` candidate-list mutant that read SKIPPED before the
  cleaner's `firstOnTree` refactor's rename — is now closed).
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1385's feature — 13/13.
- Guard self-check (`check_handler_module_graph.sh`, no args) — exit 0.
- Guard against the real incident commit (`check_handler_module_graph.sh
  a93aa4a18f .`) — `HANDLER_LOAD_BLOCK`, names `bl1296BubbleSeatSteps.js`
  and the unresolvable `bubbleSeat` module, reproducing the real 2026-09-04
  incident.
- Both `required_wiring` consumer anchors confirmed live:
  `run_commit_guards.sh:73` (`run_guard check_handler_module_graph.sh`),
  `land_step_lib.bb:993` (in the replayed-tree-guards list).
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- No orphaned test/mutation processes before or after.

## Two silent-content-loss defects found and fixed BEFORE landing

Merging `ee0e129a6b` into the QA worktree (`c7ff0f0369`) auto-resolved
`docs/index.md` cleanly and required manual conflict resolution on
`docs/reference/Specification.MD`. Both silently dropped content:

1. **BL-1367's own `docs/index.md` line** (added by this session's earlier
   BL-1367 land, `9e6170fb06`) vanished from the auto-merge — no conflict
   was even flagged for that file. Caught by diffing the BL-* reference set
   in `docs/index.md` against the pre-merge commit (`b4824b0bb8`) rather
   than trusting the merge.
2. **BL-1367's own `Specification.MD` entry** was deleted during my own
   manual conflict resolution: it sat inside the same conflict hunk as a
   genuinely-duplicate `BL-1371` block, and I removed the whole hunk after
   confirming only the `BL-1371` portion was duplicate — the BL-1367 entry
   immediately following it was the ONLY copy and got deleted with it.
   Caught by comparing the full entry-title set (221 titles) against
   `b4824b0bb8` — same count but BL-1367 missing from the set confirmed it,
   not just eyeballing the diff.
3. **BL-1385's own two `docs/index.md` line enrichments** (the BL-1252 and
   BL-1371 summary-line updates naming the new handler-module-graph guard)
   had reverted to their pre-BL-1385 wording somewhere in the documenter's
   own bounce/rework branch history, between an earlier documenter commit
   (`916417203c`, which had the correct enriched wording) and the tip I
   received (`ee0e129a6b`). Not caught by the same reference-set diff (the
   lines exist, just with stale wording) — caught by grepping both lines
   for `BL-1385` directly and finding zero hits where two were expected.

Fixed in the QA worktree first (`595fb47cfa`, committed and re-verified
before this land's own-paths extraction began), so none of the three
defects reached this commit. Restored content: BL-1367's lines from
`b4824b0bb8`; BL-1385's own lines from `916417203c` (independently confirmed
accurate against the current `docs/how-to/BL-1252-*.md` and
`BL-1371-*.md` pages, which already correctly describe the guard).

**Lesson for this land's own diff-filter=D discipline**: `git diff
--diff-filter=D` only catches whole-FILE deletions. It is silent on
content dropped WITHIN a file that survives a merge — exactly this
defect's shape. Comparing a semantic content set (here: the BL-* reference
list) against the pre-merge parent is the check that actually catches it.

## Hand-built tip-pure commit

Built in scratch worktree `/tmp/land-bl1385`, off `origin/main` at
`9e6170fb06` (the tip left by this session's BL-1367 land). Own-paths (26
files, including the corrected `docs/index.md`/`Specification.MD` splices
above) cross-checked against `git diff --name-only origin/main <QA-tip,
post-fix, 595fb47cfa>` — clean this time, no BL-1367-exclusive files
present (already landed) and no other foreign tickets' content.

`land_step_cli.bb` DID produce a replay this time (`LAND_REPLAY
land-replay/BL-1385-c7ff0f0369 d53e4ddd39b274f4f4900f92a68ad276e2932fbb`) —
not reviewed/used, since the hand-build was already the safer known-good
path this session and its 27-entangled-sibling list is the known inflation
class.

One mechanical issue in the hand-build: `git show <tip>:<path> > <path>`
does not preserve the executable bit, so the three checked-out `.sh` files
lost their `+x` and the pre-commit `check_handler_module_graph.sh` guard
itself refused with "Permission denied" (exit 126) on the FIRST commit
attempt — caught immediately by the guard's own refusal, `chmod +x`'d the
three shell files, re-committed clean.

## Re-verified on the tip-pure tree

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/bl1385_handler_module_graph_mutation_sweep.sh`
  — 9/9 killed, 0 skipped.
- `specs/pipeline/scripts/run_acceptance.sh` on BL-1385's feature — 13/13.
- `bash swarmforge/scripts/check_feature_handler_registration.sh` — rc 0.
- `bash swarmforge/scripts/check_handler_module_graph.sh` (self-check) —
  exit 0.
- `git diff --diff-filter=D origin/main --cached` — empty.

## Landed

- Tip-pure commit `a699ff1fb2` off `origin/main` at `9e6170fb06`. Both
  `land_main_publish.sh --decide-only` calls read `:next :push`,
  `origin-advanced-since-gate: false`. Pushed `9e6170fb06..a699ff1fb2`.
- Follow-up commit `438951f8e8`: appended `d53e4ddd39` (the automated
  replay, not used) to `abandoned_commits`. Pushed
  `a699ff1fb2..438951f8e8`.
- Both pushes went through `land_main_publish.sh --acquire-lock` /
  `--decide-only` / `--release-lock` (BL-1144 discipline).
- Scratch worktree `/tmp/land-bl1385` removed after the second push.

## Not a GH-seeded ticket

`BL-1385`'s `id` is not `GH-<n>`; no `issue_done.sh` step applies.

By QA.
