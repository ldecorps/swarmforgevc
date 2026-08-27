# BL-848 — cleaner pass — 2026-08-07

Received `2a1ecc3c8a` from coder (`merge_and_process`), merged clean into
`swarmforge-cleaner` as `6e015ce6`. One pre-existing untracked file
(`swarmforge/scripts/process_table_lib.bb` and its test runner) blocked the
merge only because it was byte-identical to what the incoming commit itself
carried — removed and let the merge recreate it, no content lost. A second
pre-existing untracked file, `swarmforge/scripts/operator_path_lib.sh`,
matches paused BL-796 (documented precedent in prior QA/architect evidence,
e.g. `BL-650-qa-pass-20260807.md` item 10) — left alone, not staged, not
this ticket's to touch.

## Checks run

1. **Unit** — `bb swarmforge/scripts/test/hotfix_certification_lib_test_runner.bb`: ok.
2. **Property** — `bb swarmforge/scripts/test/bl848_hotfix_certification_property_runner.bb`: ok.
3. **Wiring smoke** — `bash swarmforge/scripts/test/test_operator_runtime_hotfix_certification_sweep.sh`: all 12 checks passed (cadence gate, coordinator nudge via real `swarm_handoff.bb`, resurfacing, dedup).
4. **Gherkin acceptance** — `node specs/pipeline/cli.js specs/features/BL-848-hotfix-swarm-certification-recurring-check.feature`: 10/10 scenarios passing.

## Cleanup review (Article, Cleanup Order)

- **Coverage** — all new behavior (state machine, ledger parse/render, declared-hotfix detection, unaccounted-commit queue, resurfacing/dedup, the `operator_runtime.bb` sweep wiring) is covered by the four suites above; nothing uncovered found.
- **CRAP/mutation/DRY tooling** — this is Babashka (`.bb`); per the Engineering Rules Startup Tools table these tools are not wired for `.bb`. Gate is the unit-test suite only, run above. No Kotlin/TS surface touched.
- **Module structure** — `hotfix_certification_lib.bb` is a pure snapshot-in/findings-out decision core with no git/fs/clock dependency, matching the existing `babysitterd_sweep_lib.bb` posture; all I/O (ledger read/write, git log/diff-tree, ticket-status resolution, coordinator nudge send) is isolated in `operator_runtime.bb`'s `hotfix-certification-sweep!` and its private helpers. `hotfix_ledger_update.bb` is a small, single-purpose CLI wrapper around the same pure lib for the two durable, human-only facts. Separation of concerns is clean; no split needed.
- **Duplication** — `operator_runtime.bb`'s private `find-ticket-file` duplicates `ticket_status_lib.bb`'s glob-scan shape; the code comments this explicitly and note `ticket_status_lib` exposes only a boolean status, not the `human_approval` field this sweep also needs. Accepted as the same small live-glue duplication rationale already used elsewhere in the file (`read-yaml-field`) — not meaningful duplication to eliminate.
- **Mutation-site size (BL-485)** — not applicable; `mutation-site-count.js` targets compiled TS (`out/**/*.js`); no TS files changed by this parcel.

## Verdict

No defects found, no cleanup changes required beyond the merge itself. Forwarding to architect.

By cleaner.
