# BL-1309 — LAND SUCCESS, 2026-09-04

Fifth land this session/turn. Full re-verification, the rebuild-vs-fresh-
build context, and independent ruling-legitimacy re-verification are in
`BL-1309-qa-pass-20260904.md`, written before this land attempt.

## Merge-deletion guard needed a cherry-pick, not a message fix

The documenter merge (`9b73907f80`) deleted two `backlog/INTAKE-*.md` files
whose introducing commits carry no ticket id in their subject
(`aa1cec1d7e`, `f244b73b98`) — the guard's `ticket_id_for_path` returns
empty for both, so no commit message can satisfy it (the guard's own logic
short-circuits to "violation" on an empty id regardless of message
content). Aborted the merge, cherry-picked the actual archiving commit
(`a993f97e14`, ancestor-confirmed) onto this branch first, then re-ran the
merge cleanly — the deletion then already existed on this branch's own
history and the merge introduced nothing new for those two paths.

## Same standing over-inclusion class, LAND_REPLAY not LAND_ESCALATE

`land_step_cli.bb` returned `LAND_REPLAY` cleanly (no missing-registry-
module refusal — BL-1371's discovery registration means this ticket's own
step handler and fixture files, already on `origin/main` from earlier
scaffolding, needed no `index.js` edit either). Automated replay's 34-file
diff against `origin/main` included, beyond BL-1309's own 22: two other
tickets' own `backlog/done/*.yaml`, one unrelated INTAKE file, two other
tickets' own `docs/how-to/*.md` edits (BL-1175/BL-1356, BL-611/BL-1359),
one unrelated generated briefing file, and `docs/index.md`/
`Specification.MD` stacking two other tickets' (BL-1367, BL-1360) entries.
`docs/how-to/BL-1144-frequent-qa-push-races-on-main-land.md` — excluded for
every OTHER ticket landed this session as "not theirs" — is genuinely
BL-1309's own here (its how-to page, extended in place); verified the
diff's scope directly before including it whole.

## Hand-built tip-pure commit

22 whole-file checkouts (ticket YAML + 14 evidence + `land_main_publish.sh`
+ the BL-1144 how-to page + step handler + fixture CLI + property test +
feature file + mutation-sweep script + test runner) + 2 line-level splices
(`docs/index.md` one line; `docs/reference/Specification.MD` one 34-line
entry, excluding BL-1371/BL-1367/BL-1360's stacked below it — the same
duplicate-BL-1371 trap as BL-1374's own land, checked for and not
repeated). Built off `origin/main` at `f932266270` (BL-1374's own
just-landed tip). `git diff --cached --stat origin/main`: 25 files, 2160
insertions(+), 14 deletions(-) — the 14 deletions are entirely within the
ticket YAML's own bookkeeping. Every `.js`/`.sh`/`.md`/test file blob-
verified byte-identical to the cited commit before commit.

## Re-verified on the tip-pure tree — the mechanism this session's own
lands depend on, tested on the tree about to become its shipped form

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `bash .../land_main_publish_test_runner.sh` — 12/12 PASS, including
  04b/04c/04d (approved rides; withheld/pending/unreadable all refuse by
  name).
- `bash .../bl1309_entanglement_mutation_sweep.sh` — killed=9 survived=0
  equivalent=2 (both equivalences re-derived from source on this tree, not
  assumed).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1309-the-mandatory-land-decide-step-is-blind-to-entanglement.feature`
  — 10/10 pass.
- `npx vitest run --config vitest.properties.config.mjs
  bl1309LandDecideEntanglementInvariants` — 3/3 pass.

## Landed

- Tip-pure commit `5cd86ec8b3` off `origin/main` at `f932266270`. Pushed
  `f932266270..5cd86ec8b3`.
- Follow-up commit `f7b512ea80`: `abandoned_commits: [3a91efd6e6]` recorded
  on the ticket YAML (no pre-existing list on this ticket — first entry).
  Pushed `5cd86ec8b3..f7b512ea80`.
- Neither push carried any `PASSENGER_SIBLING` content.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`); both `--decide-only` calls returned a
  clean `:next :push` on the first try, using this worktree's PRE-BL-1309
  `land_main_publish.sh` — correct: this land ships the new decide-step
  behavior, so deciding on it with the currently-deployed script is the
  right reference, not circular.
- The `git commit` for the tip-pure replay backgrounded past the 120s
  foreground timeout on its FIRST attempt (property-suite-guard hook on
  TS/JS paths, same as BL-1296's own replay commit) and that attempt's
  result — piped through `tail -5` — silently reported the PIPELINE's exit
  status (`tail`'s, effectively always 0) rather than `git commit`'s;
  checking `git log`/`git status` afterward showed nothing had actually
  committed. Re-ran the plain `git commit` (no pipe) directly, which
  committed successfully on its own backgrounded completion. Lesson: a
  backgrounded command's own "completed (exit code 0)" wrapper status is
  NOT proof the piped command inside it succeeded — verify the actual
  effect (here, `git log`), not the wrapper's reported code, whenever the
  command was piped through anything.

By QA.
