# BL-1359 — LAND SUCCESS, 2026-09-04

Sixth land this session/turn, and the first resumed via a coordinator
`note` pointing at an already-approved-but-never-landed commit rather than
a documenter git_handoff. Re-verification is in
`BL-1359-qa-relanding-20260904.md`, written before this land attempt.

## `land_step_cli.bb`'s first attempt returned a false "nothing to commit"
— stale `origin/main`, not a code defect

First attempt (cited commit `e485bf815f`, this worktree's HEAD before
re-fetching) returned `LAND_ESCALATE` with `land-step replay: nothing to
commit for BL-1359 - own-paths identical to origin/main` — despite
`swarmforge/scripts/babysitter_check.bb` and `babysitterd_sweep_lib.bb`
genuinely differing from `origin/main`. Root cause: `origin/main` had moved
substantially since this worktree's last fetch — the coordinator had, in
the interim, closed BL-1296/BL-1309/BL-1374/BL-1376/BL-1377/BL-1378 to
`backlog/done/` and promoted two new tickets (BL-1386/BL-1387), all pushed
directly to `origin/main` (this worktree's own notes to the coordinator
this session, being acted on in real time). Fetched and merged the fresh
`origin/main` into this worktree first (clean, no conflicts — git detected
the ticket-file moves as pure renames); the retry against the caught-up
`HEAD` returned a normal `LAND_REPLAY`. Not a land_step_cli.bb defect —
just a stale comparison base, now on record as a way this specific
escalation shape can arise.

## Same standing over-inclusion class, plus a rematch mid-land (origin/main
kept moving)

`land_step_cli.bb`'s replay (34 files against `origin/main`) included,
beyond BL-1359's own 14: two other tickets' own `backlog/done/*.yaml`, one
unrelated INTAKE file, two other tickets' own topic-JSON bookkeeping
(BL-1386/BL-1387, unrelated concurrent activity), one other ticket's own
`docs/how-to/BL-1175-...md` edit (BL-1356), one unrelated generated
briefing file, and `docs/index.md`/`Specification.MD` stacking two other
tickets' entries. `docs/index.md` needed **no** BL-1359 splice at all —
this ticket's how-to is the BL-611 runbook, extended in place, already
linked from an earlier land. `docs/how-to/BL-611-babysitterd-runbook.md`
— excluded as "not theirs" for every OTHER ticket landed this session — is
genuinely BL-1359's own here (its "Not `-m --first-parent` (BL-1359)"
correction section); verified the diff's scope directly before including
it whole.

## Hand-built tip-pure commit

14 whole-file checkouts (7 evidence + property test + feature-stub
extension + `babysitter_check.bb` + `babysitterd_sweep_lib.bb` + unit test
runner + the BL-611 how-to page) + 2 line-level splices (`Specification.MD`
one 28-line entry between the BL-1354 and BL-1337 blocks;
`suite-manifest.tsv` one row). Built off `origin/main` at `0bcf68efa4`.
`origin/main` ADVANCED AGAIN mid-land (`0bcf68efa4` → `5781bb139c`, one
more unrelated ticket-bookkeeping line) between the tip-pure commit and
the first `--decide-only` — `:tip-contains-origin false`, so a rematch was
required (BL-1144 discipline, not skipped): `git fetch` + plain `git merge
origin/main` in the scratch worktree (clean, one trivial unrelated line,
no conflict), then re-verified `git diff --stat origin/main HEAD` was
STILL exactly the same 16-file scope before re-running `--decide-only`
(clean `:push` the second time).

## Re-verified on the tip-pure tree

Symlinked `extension/node_modules`; compiled fresh.

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `bb .../bl1359_merge_charged_test_runner.bb` — ALL PASS.
- `npx vitest run --config vitest.properties.config.mjs
  bl1359MergeChargedInvariants` — 3/3 pass, all three declared invariants.
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1359-a-merge-is-charged-only-with-what-it-introduced.feature`
  — 7/7 pass.
- `bash .../test_babysitter_check.sh` — ALL PASS (the pre-existing
  regression suite the original QA approval also ran, unaffected).

## Landed

- Tip-pure commit `fd0c301a4a` off `origin/main` at `5781bb139c` (post-
  rematch). Pushed `5781bb139c..fd0c301a4a`.
- Follow-up commit `38f61c6ee4`: `abandoned_commits: [7b4db1ccd3]`
  recorded on the ticket YAML (first entry — no pre-existing list; the
  commit cited to `land_step_cli.bb`, whose own ancestor is the original
  QA-approval commit `ea2917409f`). Pushed `fd0c301a4a..38f61c6ee4`.
- Neither push carried any `PASSENGER_SIBLING` content.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`) both times.

By QA.
