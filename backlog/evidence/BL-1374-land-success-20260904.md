# BL-1374 — LAND SUCCESS, 2026-09-04

Fourth land this session/turn. Full re-verification and the untracked
`land_step_lib_test_runner.bb` fixture-staleness finding are in
`BL-1374-qa-pass-20260904.md`, written before this land attempt; a `note`
(priority `00`) went to the specifier before landing.

## Same standing over-inclusion class

`land_step_cli.bb`'s automated replay (28 files against `origin/main`)
included, beyond BL-1374's own 14: two other tickets' own `backlog/done/
*.yaml`, one unrelated INTAKE file, three other tickets' own
`docs/how-to/*.md` edits (BL-1144/BL-1309, BL-1175/BL-1356, BL-611/BL-1359),
one unrelated generated briefing file, and `docs/index.md`/
`Specification.MD` stacking two other tickets' (BL-1367, BL-1360) entries.
`specs/pipeline/steps/bl1374SyncMergePassengersSteps.js`'s feature file
already existed on `origin/main` (BL-1371-era scaffolding, same pattern as
every ticket this session) and `docs/index.md` needed **no** BL-1374 splice
at all — this ticket's how-to is BL-1241's page extended in place, already
linked from an earlier land, not a new link.

## Hand-built tip-pure commit

11 whole-file checkouts (ticket YAML + 5 evidence + `land_step_lib.bb` +
3 test files) + 2 line-level splices (`docs/reference/Specification.MD`:
prepended BL-1374's own 26-line entry; `docs/how-to/BL-1241-...md`: inserted
BL-1374's own 45-line section between the BL-1354 and BL-1375 sections,
verified as a clean, self-contained hunk in the automated diff first) +
one `suite-manifest.tsv` row insertion. Built off `origin/main` at
`a72336cd8f` (BL-1296's own just-landed tip). `git diff --cached --stat
origin/main`: 14 files, 1213 insertions(+), 4 deletions(-) — the 4
deletions are entirely within the ticket YAML's own bookkeeping fields
(`abandoned_commits`/status churn), blob-verified against the cited commit
for every `.bb`/`.sh`/yaml file.

## Re-verified on the tip-pure tree — confirms the untracked finding is
independent of this ticket's OWN diff

`bb .../land_step_lib_test_runner.bb` still shows the SAME 2 failures
(`BL-1375`'s `BL-9009-fixture` case) on this pure tree, byte-identical to
the QA-worktree run — confirms the staleness is in the PRE-EXISTING fixture
content this ticket did not touch (checked out unmodified from the cited
commit), not introduced or masked by anything in the hand-build. All of
BL-1374's own suites green:
- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` — passed.
- `bash .../test_bl1374_sync_merge_passengers.sh` — ALL PASS (18 checks).
- `bb .../bl1374_sync_merge_passengers_property_runner.bb` — ALL PROPERTIES
  HOLD (24 fixture runs).
- `specs/pipeline/scripts/run_acceptance.sh
  specs/features/BL-1374-a-sync-merge-is-not-credited-with-its-passengers.feature`
  — 4/4 pass.

## Landed

- Tip-pure commit `850a0d4f93` off `origin/main` at `a72336cd8f`. Pushed
  `a72336cd8f..850a0d4f93`.
- Follow-up commit `f932266270`: appended `abd510a750` to the ticket's
  EXISTING `abandoned_commits:` list (`[41fc392944, 7536ae3f52]` →
  `[..., abd510a750]`, a pre-existing list from an earlier BL-1241 land-
  escalate/rework cycle this same ticket already went through — appended,
  not overwritten). Pushed `850a0d4f93..f932266270`.
- Neither push carried any `PASSENGER_SIBLING` content.
- Lock acquired/released from the shared root
  (`/home/carillon/swarmforgevc`); both `--decide-only` calls returned a
  clean `:next :push` on the first try.

By QA.
