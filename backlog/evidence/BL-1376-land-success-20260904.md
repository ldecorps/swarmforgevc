# BL-1376 — LAND SUCCESS, 20260904

Resumed in_process handoff (documenter's `0b36a1b553`, enqueued
2026-09-03T14:08:43Z). This worktree's own `BL-1376-qa-pass-20260903.md`
already recorded a full independent verification and PASS from a prior
session (merge `7da462b014`, ancestor of this session's starting `HEAD`
`a4c4a44ed5`) — that pass was never landed. Re-verified rather than trusted
blindly, given a full day and the shared-registry land-deadlock incident
had passed in between:

- `npm run compile` — clean.
- `bash swarmforge/scripts/test/test_bl1376_expedite_branch_handover.sh` —
  ALL PASS.
- `bb swarmforge/scripts/test/bl1376_expedite_branch_handover_property_runner.bb`
  — ALL PROPERTIES HOLD (500 runs).
- Invariant 2 re-grepped: `git diff origin/main..HEAD -- expedite_cli.bb
  expedite_lib.bb | grep -E "git (merge|push|checkout)"` — zero matches.
- Wiring re-confirmed: `outstanding-work` now has a single call site
  (`outstanding-now`) funneled through `report-leavings!` → the one `exit!`
  point both the run tail and the pre-flight refusal path share — stronger
  than the ticket's literal "two call sites", and scenario 6's pass proves
  the refusal path picks it up.
- `npx vitest run`: 25 failed / 578 passed test files (9971/9996 tests) —
  same 25 failing test NAMES as the prior session's baseline (file/total
  counts differ only because unrelated work landed more test files since;
  none of the 25 mention expedite/BL-1376).
- `npm run test:properties`: 7 failed/949 passed, same
  `deps.checkOrphanedAuthoredDocs is not a function` root cause as the unit
  suite's `pilotAcceptanceGate` cluster — pre-existing, unrelated. Only
  allowlisted unhandled error (BL-871 `onTaskUpdate` timeout) present.
- Acceptance 7/7 (`run_acceptance.sh` against BL-1376's own feature) in
  this worktree, where real cross-batch dependencies are present.

## `land_step_cli.bb` (BL-1241) over-included unrelated files

`bb swarmforge/scripts/land_step_cli.bb BL-1376-... <HEAD>` returned
`LAND_REPLAY`, but the replayed tree's diff against `origin/main` included:
four OTHER tickets' `backlog/topics/BL-138{1,2,3,4}.json` (deleted), two
INTAKE drain files + one INTAKE patch (deleted/added), `docs/index.md`,
`docs/how-to/BL-611-babysitterd-runbook.md`, `docs/how-to/BL-1144-...md`,
`docs/how-to/BL-1175-...md`, and `extension/docs/briefings/2026-09-03.json`
— none of them BL-1376's own. Root cause: `own-paths`' walk is file-
granular and keys on batch-commit *subjects* (e.g. "Land BL-1371; un-park
BL-1367/BL-1374/BL-1376/BL-1377/BL-1378 hold/ -> paused/"), so a commit's
entire diff gets attributed to every ticket its subject names. This is the
same known class as BL-1337/BL-1342/BL-1344/BL-1350/BL-1352's own land-
success evidence today — not novel, not escalated.

First replay attempt (`6ff5d41a30`) was also built off a since-superseded
`origin/main` (two unrelated `BL topic record` commits landed mid-
verification) and would have deleted `backlog/topics/BL-1381.json` — a file
another role had just legitimately landed. Rerunning the CLI against fresh
`origin/main` reproduced the same over-inclusion (now against BL-1381-1384),
confirming it is the attribution walk, not staleness.

## Hand-built tip-pure commit, own-paths derived and cross-checked

- Own-paths (15 entries) derived from the coder/cleaner/architect/
  hardener(batch)/documenter evidence trail plus a direct re-diff of every
  file the automated replay touched, classified file-by-file. Confirmed via
  `git diff origin/main..a4c4a44ed5 -- <path>` for each of the 4 files NOT
  in the mint-evidence list (`docs/index.md` — 0% BL-1376 content, entirely
  other tickets' index entries; `docs/reference/Specification.MD` and
  `swarmforge/scripts/test/suite-manifest.tsv` — shared append-only files,
  needed line-level splice; `swarmforge/scripts/test/expedite_lib_test_runner.bb`
  — confirmed a clean pure-append of BL-1376's own test block, safe whole).
- `docs/reference/Specification.MD`: prepended only BL-1376's own 27-line
  entry (lines 3-29 of the cited commit's version) onto CURRENT
  `origin/main`'s content, rather than checking out the whole file (which
  would have replayed this worktree's STALE copy — missing BL-1371's entry
  that had landed independently — over origin/main's fresher one).
- `swarmforge/scripts/test/suite-manifest.tsv`: inserted only the
  `test_bl1376_expedite_branch_handover.sh` row at its sorted position.
  Verified the other 7 rows the automated replay would have added
  (`bl1359_merge_charged_test_runner.bb`, `ceremony_handoff_lib_test_runner.bb`,
  `suite_baseline_lib_test_runner.bb`, `test_bl1374_sync_merge_passengers.sh`,
  `test_bl1378_expedite_close_guard.sh`, `test_ceremony_handoff_cli.sh`,
  `test_suite_baseline_cli.sh`) name files NOT present on `origin/main` —
  landing those manifest rows without their files would have broken the
  standing suite runner for everyone (the BL-1324 require-line-leak class,
  applied to the manifest instead of `index.js`).
- Built in scratch worktree `land-replay-worktrees/bl1376-landtry`, off
  `origin/main` at `99ddf0a282`. `git status` after the 13 wholesale
  checkouts + 2 splices confirmed exactly the 15 expected files, nothing
  extra (`git diff --cached --stat origin/main`: 15 files, 912
  insertions(+), 12 deletions(-)).
- Re-verified on the tip-pure tree (symlinked `node_modules`, compiled
  fresh against `origin/main`'s own source): `npm run compile` clean;
  `expedite_lib_test_runner.bb` ALL PASS (includes BL-1376's own new
  assertions); `test_bl1376_expedite_branch_handover.sh` ALL PASS;
  `bl1376_expedite_branch_handover_property_runner.bb` ALL PROPERTIES HOLD.

## Acceptance runner is standing-red on pure `origin/main` — unrelated to BL-1376

`run_acceptance.sh` on the tip-pure tree crashed loading ANY feature
(tried BL-1376's own and an unrelated long-landed one, `BL-091`), both with
the identical error: `specs/pipeline/steps/index.js`'s directory-discovery
loader (BL-1371) eagerly `require`s every `*Steps.js` file it finds,
including `bl1296BubbleSeatSteps.js` — landed standalone as part of the
"handler files first" shared-registry-deadlock remedy
(`backlog/evidence/BL-1296-land-deadlock-shared-registry-20260903.md`),
whose `require(path.join(EXT_ROOT,'out','tools','bubbleSeat'))` has no
backing `extension/src/tools/bubbleSeat.ts` on `origin/main` yet. That
adjudication verified the LAND-TIME guard (`check_feature_handler_
registration.sh`) tolerates an unregistered handler; it did not check the
RUNTIME loader, which is unconditional and crashes regardless of
registration. This currently breaks acceptance testing for every ticket
building fresh off `origin/main`, not just this one. Flagged to the
specifier separately (`note`, priority `00`) — not a BL-1376 defect, and
BL-1376's own acceptance is independently proven 7/7 in this worktree
where the real dependency chain exists.

## Landed

- Tip-pure commit `049161fc03` on `land-replay/BL-1376-a4c4a44ed5-a4c4a44ed5`
  side branch `bl1376-landtry`, off `origin/main` at `99ddf0a282`.
  `origin/main` re-fetched and confirmed unchanged immediately before
  push — no rematch needed. Pushed `99ddf0a282..049161fc03` to `main`.
- Follow-up commit `c142535f68`: `abandoned_commits: [a4c4a44ed5]` recorded
  on the ticket YAML (`backlog/paused/BL-1376-...yaml`, its current
  location — see below), off `origin/main` at `049161fc03`, no rematch
  needed. Pushed `049161fc03..c142535f68`.
- Neither push carried any `PASSENGER_SIBLING` content — the hand-built
  own-paths list excluded every file the automated tool would have ridden
  in on shared paths, so no other ticket's `abandoned_commits` bookkeeping
  is owed from this land.
- Both pushes went through `land_main_publish.sh --acquire-lock` /
  `--decide-only` / `--release-lock` (BL-1144 discipline).
- `swarmforge-QA` merged up to `c142535f68` (`813c79084e`). Merge conflicts
  in `docs/reference/Specification.MD` and `suite-manifest.tsv` (this
  worktree's own accumulated unlanded entries for BL-1367/1360/1296 and
  BL-1374/1378 respectively, vs. the just-landed BL-1376-only versions) —
  resolved by keeping this worktree's fuller set (verified: BL-1376's own
  entry appears exactly once; diffed the merge against BOTH parents,
  confirmed no file present in either parent is missing from the merge
  result, and the 4 renamed tickets' paused→active moves preserved
  byte-identical content).
- Scratch worktrees and branches removed after each push.

## Ticket bookkeeping note for the coordinator

`backlog/paused/BL-1376-the-expedite-handover-never-names-the-unlanded-branch.yaml`
still reads `status: todo`, `assigned_to: coder` — stale from the BL-1375
park/BL-1371 un-park bookkeeping cycle (un-parked `hold/` → `paused/`, not
`active/`, and without restoring the pipeline-progress fields). The actual
work is fully QA-approved and landed. Coordinator: this ticket needs its
`backlog/paused/` → `backlog/done/` move (not the usual `active/` →
`done/`), same as the other four siblings un-parked in that same commit.

By QA.
