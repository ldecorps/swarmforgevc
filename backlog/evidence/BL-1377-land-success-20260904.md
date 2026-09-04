# BL-1377 — LAND SUCCESS, 2026-09-04

Resumed in_process handoff (documenter's `50af836208`, `TASK_NAME
BL-1377-a-suites-failure-set-is-recorded-once-per-base-commit`). This
worktree's own `BL-1377-qa-pass-20260904.md` already recorded a full
independent verification and PASS from an earlier session in this same
context (merge `b2112dd26b`, evidence commit `5fcb4522b5`) — that pass was
never landed; the handoff was still sitting `in_process` at the start of
this turn. Re-verification was not repeated (no elapsed-time or drift
concern — this is a direct continuation), but the land step itself had to
be done from scratch.

## `land_step_cli.bb` (BL-1241) over-included unrelated files — same known
class as BL-1376/BL-1337/BL-1342/BL-1344/BL-1350/BL-1352

`bb swarmforge/scripts/land_step_cli.bb BL-1377-... 5fcb4522b5` returned
`LAND_REPLAY land-replay/BL-1377-5fcb4522b5 66016ae96f`, but the replayed
tree's diff against `origin/main` (23 files) included: `backlog/done/BL-1337-...yaml`
and `backlog/done/M8/BL-1328-...yaml` (both other tickets' own bookkeeping),
one unrelated human INTAKE file, `docs/how-to/BL-611-babysitterd-runbook.md`
(BL-1359's own edit), `docs/how-to/BL-1144-...md` (BL-1309's own edit),
`docs/how-to/BL-1175-...md` (BL-1356's own edit), `extension/docs/briefings/2026-09-03.json`
(unrelated generated file), and three shared files (`docs/index.md`,
`docs/reference/Specification.MD`, `swarmforge/scripts/test/suite-manifest.tsv`)
carrying several OTHER tickets' entries stacked alongside BL-1377's own.
Root cause unchanged from BL-1376's write-up: `own-paths`'s walk is
file-granular and keys on batch-commit *subjects*, so a shared batch
commit's entire diff gets attributed to every ticket its subject names.
Not novel, not escalated — same standing gap.

The first attempted run of the CLI also failed outright with
`land-step replay: could not create worktree ... off origin/main` — reproduced
as a transient race: a concurrent `land_main_publish.sh --decide-only` (run
moments earlier per the Verification Order step, backgrounded because it
took >120s against this worktree's ~400-commit-deep sibling walk) was still
mid-fetch when the CLI tried its own `git worktree add`. Manually
reproducing the exact `git worktree add -b ... origin-main` command in
isolation succeeded both before and after; re-running the CLI once the
background fetch had completed succeeded cleanly. Not a code defect.

## Hand-built tip-pure commit, own-paths derived and cross-checked

Own-paths (13 whole-file + 3 spliced) derived from the coder/cleaner/
architect/hardener(batch)/documenter/QA evidence trail, cross-checked
file-by-file against the automated replay's 23-file diff:

- 13 wholesale checkouts from cited commit `5fcb4522b5` (blob hashes,
  including exec bits, verified byte-identical to the cited commit after
  checkout): `suite_baseline_lib.bb`, `suite_baseline_cli.bb`,
  `suite_baseline.sh`, the three new test runners, `bl1377SuiteBaselineSteps.js`'s
  feature file (`specs/features/BL-1377-...feature` — a pre-existing
  specifier-authored stub on `origin/main`, extended with the hardener's
  mutation-stamp header + full scenarios), the new how-to page, and all
  five BL-1377 evidence files (coder/cleaner/architect/documenter/this
  session's qa-pass).
- `specs/pipeline/steps/index.js`: **no edit needed** — BL-1371's
  directory-discovery loader means a new top-level `*Steps.js` file
  registers itself; the automated replay's diff against this file was
  already empty, confirming no hand-maintained registration line exists to
  splice.
- `docs/index.md`: spliced in only BL-1377's own one-line how-to link, at
  its sorted position (between the BL-566 and BL-595 entries) — excluded
  BL-1360's and BL-1296's lines that the automated tool bundled in on the
  same hunk.
- `docs/reference/Specification.MD`: prepended only BL-1377's own 26-line
  entry onto CURRENT `origin/main` content (never checked out the cited
  commit's whole file, which would have replayed six OTHER tickets'
  Last-Updated entries stacked on top of it — BL-1367/BL-1360/BL-1296/
  BL-1359/BL-1356/BL-1309 all landed independently since BL-1377 was
  documented).
- `swarmforge/scripts/test/suite-manifest.tsv`: inserted only the two
  BL-1377 rows (`suite_baseline_lib_test_runner.bb`,
  `test_suite_baseline_cli.sh`) at their sorted positions — excluded five
  other tickets' rows (BL-1359/BL-1360/BL-1374/BL-1378) the automated tool
  bundled in.
- Built in scratch worktree `land-replay-worktrees/bl1377-landtry`, off
  `origin/main` at `c142535f68`. `git diff --cached --stat origin/main`
  confirmed exactly the 16 expected files, nothing extra (1458
  insertions(+), 0 deletions — every touched file purely additive, unlike
  BL-1376's two-line splices).

## Re-verified on the tip-pure tree

Symlinked `extension/node_modules` from this worktree; compiled fresh
against `origin/main`'s own source.

- `npm run compile` — clean.
- `check_feature_handler_registration.sh <tree> --assume-main` (the land
  replay's own tree guard) — passed clean.
- `bb swarmforge/scripts/test/suite_baseline_lib_test_runner.bb` — ALL PASS.
- `bash swarmforge/scripts/test/test_suite_baseline_cli.sh` — ALL PASS (37
  checks).
- `bb swarmforge/scripts/test/bl1377_suite_baseline_property_runner.bb` —
  ALL PROPERTIES HOLD (500 runs).

## Acceptance runner is standing-red on pure `origin/main` — unrelated to BL-1377, already tracked

`run_acceptance.sh` on the tip-pure tree crashed loading BL-1377's own
feature: `specs/pipeline/steps/index.js`'s directory-discovery loader
(BL-1371) eagerly `require`s every `*Steps.js` file it finds, including
`bl1296BubbleSeatSteps.js` (hand-landed 2026-09-04 01:31 BST by the now-
retired "handler files first" shared-registry-deadlock route), whose
`require(path.join(EXT_ROOT,'out','tools','bubbleSeat'))` has no backing
`extension/src/tools/bubbleSeat.ts` on `origin/main` yet — this is the
IDENTICAL failure BL-1376's own land hit an hour earlier on this same
`origin/main`. Already fully adjudicated, not a fresh finding: QA `note`
sent 2026-09-04T08:18Z ("origin/main acceptance runner crashes on ANY
feature (BL-1296 handler gap)"); specifier minted **BL-1385** (durable
guard, `check_handler_module_graph.sh`) off it, with adjudication evidence
`backlog/evidence/BL-1296-orphan-handler-crashes-discovery-20260904.md`
naming the repair as "QA's and is already asked for by note (land BL-1296,
which is approved and waiting)". Per Article 4.4's structural-cause
discipline (one escalation per class, not per ticket): nothing new to add,
so no second note sent. BL-1377's own acceptance is independently proven
10/10 in this worktree (recorded in `BL-1377-qa-pass-20260904.md`), where
the real dependency chain (BL-1296's own unlanded source) is present — same
reasoning BL-1376's land evidence already used.

## Landed

- Tip-pure commit `2ff63365c9` on scratch branch (detached, built off
  `origin/main` at `c142535f68`). `origin/main` re-fetched and confirmed
  unchanged immediately before push — no rematch needed. Pushed
  `c142535f68..2ff63365c9` to `main`.
- Follow-up commit `4028373a4d`: `abandoned_commits: [5fcb4522b5]` recorded
  on the ticket YAML (`backlog/paused/BL-1377-...yaml`, its current
  location on `origin/main` — see below), off `origin/main` at `2ff63365c9`,
  no rematch needed. Pushed `2ff63365c9..4028373a4d`.
- `task_scope_gate_cli.bb BL-1377-... <tip-pure commit> .` returned `OK`
  independently of the `abandoned_commits` edit (the tip-pure commit's own
  diff against `origin/main` is already fully in-scope) — recorded anyway
  as the durable audit trail per `swarmforge/backlog-schema.md`.
- Neither push carried any `PASSENGER_SIBLING` content — the hand-built
  own-paths list excluded every file the automated tool would have ridden
  in on shared paths (`docs/index.md`, `Specification.MD`,
  `suite-manifest.tsv` were all line-level spliced to BL-1377's own
  addition only), so no other ticket's `abandoned_commits` bookkeeping is
  owed from this land.
- **Lock-location correction, this session**: `land_main_publish.sh
  --acquire-lock`/`--release-lock` must run against the SHARED root
  (`git rev-parse --show-toplevel` of the MAIN checkout,
  `/home/carillon/swarmforgevc`) — running `--acquire-lock` from the
  scratch replay worktree instead creates the lock directory under that
  worktree's OWN `.swarmforge/`, which is a different, unshared path (BL-1298's
  same `.git`-is-a-file-in-a-linked-worktree class, applied to a different
  consumer). `--decide-only` and `git push` still run from the worktree
  holding the candidate commit (per `land-main-publish-root-must-be-
  candidates-worktree`); only the lock acquire/release pair needs the
  shared root. Caught mid-turn when `--decide-only`, run while holding a
  self-created-but-wrong-path lock, reported `:lock-admission
  :rematch-once-at-edge` (the admission logic has no self-vs-peer
  distinction — any existing lock directory it did not itself just create
  reads as contention) even though nothing had actually changed; re-running
  from the correct shared root produced a clean `:next :push` immediately.
  Both pushes above went through `land_main_publish.sh --acquire-lock` (from
  `/home/carillon/swarmforgevc`) / `--decide-only` (from the scratch
  worktree) / `--release-lock` (from `/home/carillon/swarmforgevc`) — BL-1144
  discipline, corrected mid-flight.
- `swarmforge-QA` branch not yet merged up to `4028373a4d` at the time of
  writing this file — done immediately after, in the same turn (see commit
  history for the merge).

## Ticket bookkeeping note for the coordinator

`backlog/paused/BL-1377-...yaml`'s `status:`/`assigned_to:` fields are still
the mint-time snapshot (`status: todo`, `assigned_to: coder`) — never
updated by any pipeline stage, same standing gap BL-1376 hit. The file's
real location is `backlog/paused/`, not `backlog/active/` (per `git log`:
last touched by `876bd76f08 Land BL-1371; un-park BL-1367/BL-1374/BL-1376/
BL-1377/BL-1378 hold/ -> paused/`, an expedite-teardown un-park that landed
in `paused/` rather than `active/`) — flagging so the coordinator's
active→done bookkeeping step looks in the right place.

By QA.
