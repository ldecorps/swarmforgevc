# BL-1640: bounce-fix (D1) — coder

QA's bounce (`backlog/evidence/BL-1640-bounce-20260921.md`) found one
defect, D1, blamed on coder: `finish_shift_run_closing_ceremony`
(`swarmforge/scripts/finish_shift_lib.sh`) calls the ceremony CLI without
`--conf`, so the deadline arithmetic silently falls back to a DIFFERENT
conf file (or the hardcoded 25/10-minute defaults) whenever the caller's
CWD differs from `--target` - exactly the shape `./finish-shift <path>`
runs in.

## Fix

`finish_shift_run_closing_ceremony` now passes
`--conf "$root/swarmforge/swarmforge.conf"` explicitly on every tick,
matching the shell test's own `tick_at` pattern
(`test_bl1640_sleep_runs_ceremony_to_done.sh`) - the budgets read never
depend on the caller's CWD again.

## Regression test

`test_finish_shift_lib.sh` case 15: runs
`finish_shift_run_closing_ceremony` with CWD set to this worktree's own
root (a real repo, but not the fixture - QA's own repro shape) against a
fixture configured for 1-minute drain / 1-minute briefing budgets;
asserts `drainDeadlineMs - startedAtMs == 60000` and
`hardDeadlineMs - startedAtMs == 120000`.

Break-then-restore: reverted the `--conf` flag locally and directly
re-ran QA's own manual repro shape (CLI invoked with CWD ≠ `--target`,
1/1-minute budgets configured) - confirmed the wrong 25/10-minute
defaults (`drain delta: 1500000 hard delta: 2100000`) are what the
unfixed line produces, matching QA's own bounce numbers exactly. Did
NOT run the full `--conf`-less test 15 to completion under `bash
test_finish_shift_lib.sh`: with the wrong (25-minute-out) hard deadline
and `FINISH_SHIFT_CEREMONY_TICK_SECONDS=0` (no sleep between ticks, no
fast-forwarded clock), the loop would need up to ~25 real minutes to
reach `overran` in a fixture with no real documenter to reach `done`
naturally - aborted that run once the manual repro had already isolated
the exact mechanism, to avoid a needless real-time wait. Restored the
`--conf` flag and re-ran `test_finish_shift_lib.sh` to completion:
18/18 PASS, case 15 included.

## Verification

- `bash swarmforge/scripts/test/test_finish_shift_lib.sh`: 18/18 PASS
  (17 pre-existing + new case 15).
- `bash swarmforge/scripts/test/test_bl1640_sleep_runs_ceremony_to_done.sh`:
  ALL PASS (unchanged - its own fixture already `cd`s into the target,
  so it never exercised D1's shape; ancestry unaffected by this fix).
- `node specs/pipeline/cli.js specs/features/BL-1640-a-finish-shift-sleep-runs-the-closing-ceremony-to-done.feature`:
  6/6 ok.
- `npx vitest run test/nightClosingCeremonyLive.test.js test/nightClosingCeremonyRun.test.js`:
  30/30 pass (these files are unchanged by this fix; re-run for safety
  since they came in through the merge).
- Manual repro of QA's own exact scenario (CWD = this worktree root,
  `--target` a separate scratch fixture, 1/1-minute budgets configured):
  `drainDeadlineMs - startedAtMs = 60000`, `hardDeadlineMs - startedAtMs
  = 120000` - matches the configured budgets exactly, not the 25/10-minute
  defaults QA's bounce named.

## Not touched (per the bounce's own remediation pointer)

The "deeper fix" the bounce named as optional (making
`night-closing-ceremony-run.ts`'s own `--conf` default resolve from
`--target` rather than `process.cwd()`, via `resolveCliMainWorktreeContext`/
`resolveProjectRoot`) is out of this bounce's scope - those helpers are
shared by other CLIs (`swarm-metrics.ts`, `generate-backlog-dashboard.ts`,
`generate-docs-tree.ts`) and QA's own remediation pointer named the
shell-side explicit `--conf` as the in-scope fix.
