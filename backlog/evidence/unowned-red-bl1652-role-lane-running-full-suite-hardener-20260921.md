# Unowned red: bl1652HandoffdRespawnReadingsWiring "role-lane-running?" — full-suite-only, 2026-09-21

Found while running a scoped Stryker dry run for BL-1640 (which requires the
whole unit suite to be green before it can mutate anything, per Stryker's
own `coverageAnalysis: perTest` contract).

`test/bl1652HandoffdRespawnReadingsWiring.test.js`'s
`role-lane-running?: a role-info with no matching lane process reads false`
fails **only under the full suite** (`npx stryker run --mutate
"out/quality/nightClosingCeremonyLive.js" --force`, which drives the whole
vitest suite for its dry run) — expected `false`, got `true`. Reproduced
twice, deterministically, at host load ~3-11 on 20 cores (not a load-crash
shape).

Run standalone (`npx vitest run
test/bl1652HandoffdRespawnReadingsWiring.test.js`), all 7 cases in that
file pass, including this one — twice confirmed.

Not investigated further: this test file and the code it exercises
(`swarmforge/scripts/lane_process_lib.bb`'s `lane-running?`,
`handoffd.bb`'s `role-lane-running?`) are entirely outside BL-1640's domain
(night-closing-ceremony). `lane-running?` scans the REAL, HOST-WIDE process
table (`process-table-lib/list-processes!`) scoped by worktree path — a
process spawned by an earlier test in the same suite run
(`exec -a run_acceptance.sh sleep 30`, matching
`lane_process_lib.bb`'s own `lane-process-pattern`) not yet reaped by the
time this test's scan runs is the likely shape, but `test/laneProcessLib.test.js`
and three other files spawn the identical fake-process pattern, and I did
not trace which one interferes.

No entry names this exact full-suite-only interaction in
`backlog/standing-reds.tsv` or elsewhere in `backlog/`; the closed ticket
that authored this test file is BL-1652 (`backlog/done/`).

Not blocking BL-1640: I fell back to a hand-authored mutation sweep on the
new/changed functions instead of the full Stryker dry run (see the BL-1670
hardening pass's precedent for this fallback shape, applied here for a
different reason - the dry run's own precondition failing, not missing
tooling).

By hardener.
