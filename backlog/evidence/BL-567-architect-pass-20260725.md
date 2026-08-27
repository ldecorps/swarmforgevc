# BL-567 architect pass — 2026-07-25

Hand-run stage 4. Two deliverables: a property suite with its non-vacuity proof,
and one HIGH defect found in the coder stage's own work.

## D1 (HIGH) — the stage timeout was reported, never enforced

`run-stage!` called blocking `sh`, then computed `stage-timeout-verdict`
**afterwards**. A stage that genuinely hangs therefore blocked the driver forever;
the verdict could only ever describe a stage that had already returned.

This is the worst possible place in this tool for a report-only timeout, and the
design said so in its own words: *"by stopping the stack the expeditor kills the
babysitter and the Operator — the two processes that would otherwise notice it
wedging. It has deliberately killed its own watchdog."*

**Why the scenario passed anyway.** The fixture's "slow" runner slept 2 s and
**returned**. It was never hung. So scenario 15 exercised a stage that finished
late, not one that never finishes — the guard was correct for the case it was
aimed at, with the real case uncovered. Same shape as BL-590's bounces #3 and #5.

Measured before the fix, with a runner that never exits:

```
elapsed 63s (hit the harness's own 60s cap), verdict never reached,
orphaned `sleep` left running
```

### Two further defects inside the fix itself

The first fix used `.destroyForcibly`, and was still wrong twice over. Both were
found by a fixture that hangs for real:

1. **`.destroyForcibly` kills the direct child only.** A stage runner is a shell
   script, so its own children survive. Wrapped the command in `setsid` to make it
   a process-group leader and killed the whole group.
2. **Deref-ing a destroyed process BLOCKS** when a surviving grandchild still
   holds the stdout pipe — EOF never arrives. Output now goes to files rather than
   `:string` pipes, and a timed-out process is never deref'd.

### And a third, which is silent and worth naming

`kill -KILL -<pgid>` **exits 0, kills only the group leader, and leaves every
grandchild running.** `/usr/bin/kill` reads `-<pgid>` as an option, not a negative
pid. The `--` separator is load-bearing:

```
kill -KILL -PGID        -> rc=0, survivors=2     WRONG, and silent
kill -KILL -- -PGID     -> rc=0, survivors=0     correct
```

After: 2 s elapsed, `stage-timeout` verdict, **zero orphans**. Locked in — the
fixture now ships a genuinely hung runner (`stage-runner-hung.sh`, never returns,
spawns a grandchild) and both the CLI suite and the acceptance handler assert that
no grandchild survives.

## Property suite

`swarmforge/scripts/test/expedite_lib_property_runner.bb`, 8 properties, 500 runs
each, seeded LCG so every counterexample is reproducible.

| | property |
|---|---|
| P1 | liveness soundness: `stopped?` implies nothing alive |
| P2 | liveness completeness: everything alive is detected AND correctly named |
| P3 | `socket-files` is inert — the measured false positive, as a property |
| P4 | exactly `bound` retries then exhausted, for any bound |
| P5 | no restart outcome can retract the ticket verdict |
| P6 | `parse-args` recovers the positionals under any flag arrangement |
| P7 | exhaustion never blames a stage; spec-defect only on a real repeat |
| P8 | park destination is always `hold`, never the run's own ticket |

### Generator defect found in the suite itself

First measurement of the generator's reach:

```
probe coverage: stopped=2  live=498
```

**P1's entire `stopped? = true` branch was exercised twice in 500 runs** while the
suite reported green. A naive independent draw over 4 booleans and 2 counts makes
a fully-stopped probe ~0.5% likely. That is the recorded *"uniform draw passed 400
runs against a live defect"* trap, reproduced on this very suite.

Fixed by drawing the SHAPE first — a third fully stopped, a third with exactly one
thing alive (the case that catches a key forgotten in the liveness cond), a third
arbitrary:

```
stopped=166 live=334        bounce-repeat=251 no-repeat=249
```

Coverage is now **asserted, not assumed**: the runner fails if either branch falls
below 10% of runs, so a future tweak that skews the distribution fails loudly
instead of silently hollowing out P1 or P7.

## Non-vacuity proof

Each invariant was broken and the suite re-run at 300 runs. 7 of 8 fail
independently:

```
ok       P1  stopped? forced true
ok       P2  babysitterd MISNAMED in the alive list
subsumed P3  (see below)
ok       P4  bound off-by-one  (< n bound) -> (<= n bound)
ok       P5  restart retracts the ticket
ok       P6  a value-flag dropped from the set
ok       P7  exhaustion blames a stage
ok       P8  park destination flipped to paused
restored: ALL PROPERTIES HOLD
```

Two notes where the first attempt was not a proof:

- **P2 needed a different break.** Dropping `babysitterd` from the cond entirely
  is caught by **P1** first — an empty `alive` list makes `stopped?` true while
  something lives, which is a soundness violation. That proves P1, not P2.
  MISNAMING the entry keeps `stopped?` correct and can only be caught by P2's set
  comparison.
- **P3 is subsumed by P2 and is recorded as such rather than claimed.** P2
  recomputes the expected alive-set from the probe keys, so any `socket-files`
  influence breaks P2 too; no break can fail P3 alone. P3 is therefore a
  **regression sentinel** for the measured 2026-07-25 false positive, not an
  independent property. Calling it independent would have been the overselling
  this ticket keeps warning about.

## Verdict

PASS with D1 fixed in place rather than bounced, since this hand-run is both
architect and coder. Suites after all changes:

```
properties   8 properties x 500 runs   ALL PROPERTIES HOLD
lib unit     96 assertions             ALL PASS
CLI          53 assertions             ALL PASS
acceptance   21 scenarios              21/21
```

## Aside, and it bit me during this pass

`pkill -f 'sleep 3600'` matched the command line of the shell running the test
harness and killed it — twice, presenting as an unexplained suite failure. The
cleanup now selects by exact argv from `ps` instead. Same self-match trap that
makes `pgrep -f handoffd` invent phantom survivors, which this session already hit
once while auditing the teardown.
