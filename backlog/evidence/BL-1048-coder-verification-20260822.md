# BL-1048 — coder verification record, 2026-08-22

Slice: widen `role-ticket-pairs-for` in `swarmforge/scripts/pipeline_stage_cli.bb`
to scan the DELIVERED mailbox state (`inbox/new/`) alongside the OPENED one
(`inbox/in_process/`), through the same `mailbox-dir` resolver and the same
`batch_*` enumeration. `ticket-id-from-headers`, `reconcile-stage-map`,
`filter-active` and the allowlist are untouched — a SOURCE widening only.

## Live before/after (read-only `report` against the project root)

At the time of this pass, all four active tickets had parcels sitting in the
coder's `inbox/new/` and none in any `in_process/`:

    BEFORE (in_process only): {}
    AFTER  (new + in_process): {"BL-1032":"coder","BL-1039":"coder",
                                "BL-1048":"coder","BL-1038":"coder"}

The live board was rendering 4 of 4 active tickets as not-started — worse than
the 2 of 4 the ticket reported — while every one of their parcels sat at the
coder's door. This is exactly the Article 2.4 ten-minute chase window the board
is supposed to make visible.

## Verification run

- `swarmforge/scripts/test/test_pipeline_stage_cli.sh` — ALL CHECKS PASSED
  (8 new BL-1048 checks: delivered git_handoff; master-resident per-role `new/`
  subdirectory; still-not-started with no parcel; opened-upstream +
  delivered-downstream resolving to the later role ONLY; delivered AND opened at
  one role counted once; delivered note; delivered parcel naming a closed ticket;
  delivered `batch_*` subdirectory).
- `bb swarmforge/scripts/test/pipeline_stage_lib_test_runner.bb` — ALL TESTS PASSED.
- Acceptance `specs/features/BL-1048-a-delivered-parcel-is-not-not-started.feature`
  — 6 pass / 0 fail.
- `npx vitest run --config vitest.properties.config.mjs
  test/bl1048DeliveredParcelIsNotNotStarted.property.test.js` — 1 pass.
  Encodes BOTH declared invariants (BL-654), with asserted reach floors rather
  than hoped-for coverage, and a recorded non-vacuity pair (see the file header).

## Consumer sweep — exhaustive, not sampled

Every consumer that drives `pipeline_stage_cli.bb` was run, not a sample:

| Consumer | Result |
|---|---|
| BL-464 pipeline-board-authoritative-stage-source | 5 pass / 0 fail |
| BL-488 held-ticket-id-resolves-without-leading-token | 4 pass / 0 fail |
| BL-489 active-id-join-is-case-symmetric | 3 pass / 0 fail |
| BL-503 ticket-id-extractor-hyphen-optional | 8 pass / 0 fail |
| `extension/test/conciergeTick.test.js` + `readLiveRoleHeldTicketsCli.test.js` | 119 pass / 0 fail |
| BL-487 board-freshness-without-coordinator-sync | **2 fail — PRE-EXISTING** |
| BL-814 live-role-held-fixture-loud-degrade | **3 fail — PRE-EXISTING** |

## The two reds are PRE-EXISTING and already ticketed — not this parcel

Proven, not assumed: both features were re-run against `git show
HEAD:swarmforge/scripts/pipeline_stage_cli.bb` (this slice reverted, everything
else identical) and fail IDENTICALLY there.

Root cause is unrelated to the mailbox scan. Both step handlers copy an explicit
allowlist of bb scripts into their fixture:

    specs/pipeline/steps/bl814LiveRoleHeldLoudDegradeSteps.js:28
    REQUIRED_SCRIPT_FILES = ['pipeline_stage_cli.bb', 'pipeline_stage_lib.bb',
                             'handoff_lib.bb', 'ambulance_lib.bb', 'mono_router_lib.bb']

`handoff_lib.bb:29` now `load-file`s `daemon_cycle_guard_lib.bb` (added by
BL-1021), which no copy-list names, so the fixture bb aborts with
`java.io.FileNotFoundException` before any scan runs.

Already ticketed: **BL-973** (`backlog/paused/`, type defect, severity medium) —
"4 bb fixture copy-lists stale since BL-911 ... derive/gate the lists from the
real load-file closure and close the unrun-test gap". Left alone deliberately:
BL-506 — an approval authorizes only its own ticket's work, and BL-973 is
approved and queued to fix all four lists at once rather than two of them here.

Downstream roles: do not read those two reds as a regression from this parcel,
and do not fold their fix into it.
