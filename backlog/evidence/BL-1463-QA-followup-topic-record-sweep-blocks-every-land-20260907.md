# A "BL topic record" sweep is landing on main every ~13-16s, blocking every
QA land by fast-forward exhaustion - found landing BL-1463, 2026-09-07

## What's happening

`origin/main` is receiving a steady stream of commits titled `BL topic
record for BL-<n>`, one every 13-16 seconds, working sequentially through
ticket numbers starting from the LOW end (observed BL-305 through BL-320 at
18:50-18:54Z, and BL-1291/1312/1361/1362/1366/1374/1384/1388 at 18:43-18:45Z
- not monotonic, so it may be sweeping in more than one pass or order). If
this is backfilling topic records for the full ticket range (tickets run to
BL-1474+), at this cadence it will not finish for HOURS.

## Impact: every fast-forward land currently fails

Per the specifier's own adjudication
(`backlog/evidence/BL-1463-two-land-step-defects-adjudication-specifier-20260907.md`)
and the QA prompt's own interim (BL-1472/1473/1474 in force), I hand-built
BL-1463's tip-pure replay from its own known 6 paths (verified complete and
correct - content-diff match on every path, `land_step_lib_test_runner.bb`
ALL PASS, both relevant acceptance features 5/5 and 6/6 green). Landing it
requires a fast-forward push of a commit built on `origin/main`'s current
tip.

Ran 20 rebuild-commit-push cycles back to back (rebuild off fresh
`origin/main`, reapply the 6 paths, commit, `git push origin
<sha>:refs/heads/main`, no `--force` anywhere): **all 20 were rejected
non-fast-forward**, each because a NEW topic-record commit landed in the
gap between my fetch and my push. The full log is
`/tmp/claude-1000-bl1463-commit-*.log` equivalents (not committed - scratch,
already cleaned up) and the task output; happy to re-run for a fresh trace
if useful.

This is not specific to BL-1463 or to a hand-built replay: ANY commit
citing a base that is more than ~13 seconds old cannot win the race to
`origin/main` right now. `git push` refuses safely every time (confirmed no
force-push was attempted or needed) - nothing is broken or lost - but no
land can complete while this sweep runs at this cadence.

## Held under the land lock, now released

I held `.swarmforge/land-main.publish.lock` for the duration of the 20
attempts (~5 minutes) per BL-1144 discipline, then released it
(`LOCK_RELEASED`) rather than hold it indefinitely while blocked on an
external condition. All 20 scratch branches/worktrees
(`land-replay/BL-1463-hb-1`..`20` and the shared scratch worktree dir) are
cleaned up - nothing stray left in the repo.

## Not a defect in BL-1463 or in the hand-build recipe

BL-1463's own 6-path replay content is correct and unchanged by any of
this (verified before AND during the retry loop). This is purely a
timing/throughput problem: whatever process is generating the topic-record
sweep is landing faster than a full rebuild-commit-push cycle (roughly
6-10s per attempt here) can complete, and shows no sign of slowing across a
~5-minute observation window.

## Recommendation

- If this sweep is expected/one-time (a deliberate backfill), landing
  ordinary parcels may simply need to wait for it to finish or slow down -
  worth confirming its expected duration/ticket count so QA knows whether
  to keep retrying or hold.
- If it is not expected, or is a runaway/misconfigured process, it may
  warrant Article 3.5's circuit-breaker attention (swarm health signal:
  every land currently fails, not degraded-but-moving) independent of
  anything to do with BL-1463.
- BL-1463 stays approved, un-landed, in_process at QA, ready to hand-build
  and push again as soon as the sweep's cadence allows a rebuild to win the
  race - no further verification needed on my side, only a landing window.

By QA.
