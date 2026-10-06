# The property lane records its own duration and names its pole (BL-1619)

*How-to. Task-oriented: read the property lane's duration trend, and find
which file to look at first when a run runs long.*

## The gap

The unit lane has been measured and ratcheted since BL-078/BL-378
(`extension/.test-durations.jsonl`). The property lane (414+
`*.property.test.js` files under `extension/vitest.properties.config.mjs`,
one flat 20 s `testTimeout`) had no measurement at all: one full run took
319.94 s wall on 2026-09-16 with no duration row, no per-file work, no
pole, no verdict. Its known process-spawning shapes — one bb process per
draw, dozens of bb processes per run, fixture-spawning files that only
miss under full-lane load — were found one at a time when the flat
timeout fired under load, each becoming its own ticket verified by
re-running the slow file by hand.

## What `npm run test:properties` does now

`extension/scripts/recordPropertyDuration.js` wraps the real property-lane
run — same `vitest.properties.config.mjs`, same files, same order, same
exit status (invariant: the recorder changes nothing vitest does on a
whole-lane run). Any extra argument after `--` is forwarded to vitest
unchanged, so filtering to one file still works exactly as before this
recorder existed:

```bash
npm run test:properties -- test/someFile.property.test.js
```

A **filtered** run (extraArgs non-empty) still prints the verdict — useful
when chasing one file by hand — but appends **no** row: a one-file sample
would otherwise silently mix into the lane-wide trend and census. On every
**completed, unfiltered, whole-lane** run, pass or fail, it appends one row
to `extension/.property-durations.jsonl`:

```json
{"finished_at":"2026-10-06T02:40:41.260Z","file_count":522,"result":"pass","duration_ms":606044,"work_ms":2706800.67,"pole_ms":126870.05,"pole_file":"test/telegramFrontDeskBotCli.property.test.js"}
```

- `pole_ms` / `pole_file` — the single slowest file's duration this run.
- `work_ms` — the summed per-file duration across the run (concurrency
  means this is larger than `duration_ms`, the wall time).
- `result` — vitest's own exit status for the tests themselves (pass/fail),
  independent of any duration.

A **killed or crashed** run appends no row at all: vitest's JSON reporter
only writes its report file on completion, so the recorder's own check for
that file's existence is what tells a completed run from a killed one —
there is no separate "did it finish" bookkeeping to get wrong.

It also prints a verdict naming the pole and every file above **half the
lane's baseline `testTimeout`** (20 s baseline → 10 s threshold, the
ticket's own fixed line — never `vitest.properties.config.mjs`'s own
contention-scaled runtime value, so the verdict always names the same set
of files for the same durations regardless of host load that run):

```
property lane pole: test/telegramFrontDeskBotCli.property.test.js (126.9s)
property lane files above 10.0s: test/telegramFrontDeskBotCli.property.test.js (126.9s), ... (80 files)
property lane work 2706.8s / wall 606.0s
```

`test:properties` is unchanged as an entry point: `npm run compile && node
scripts/recordPropertyDuration.js`.

## Reading the trend

```bash
cat extension/.property-durations.jsonl
```

One line per completed run (gitignored, same as the unit lane's
`.test-durations.jsonl` and `.vitest-report.json`). There is no per-file
budget, pole register, or work ratchet for this lane yet — unlike the
unit lane's `backlog/suite-poles.tsv` ([BL-1598 how-to](BL-1598-unit-suite-pole-register-drains-the-per-file-gate.md)),
nothing here refuses a run or tracks an owned offender. That register and
ratchet are BL-791 slice E, minted from this recorder's own first-run
census — the top files by work, read once from the first row this
recorder appends on the parcel that lands it.

## Verify

```bash
(cd extension && npm test)         # the recorder's own pure helpers + wrapper, in-process
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1619-the-property-lane-records-its-duration-and-names-its-pole.feature
```

(the second command runs from the repo root — the convention every other
how-to's acceptance snippet uses, not from inside `extension/`.)

Never run the real 320 s+ `npm run test:properties` lane more than once to
verify a change to the recorder — the acceptance handler and the unit
tests drive the recorder against a stub `vitest` on `PATH`, not the real
lane.

## Related

- [The unit suite's per-file budget gate reads a pole register](BL-1598-unit-suite-pole-register-drains-the-per-file-gate.md) — the unit lane's own recorder and gate; this is its property-lane twin, with no gate of its own yet.
- The known-benign `[vitest-worker]: Timeout calling "onTaskUpdate"` unhandled-error artifact (BL-871) is unrelated to this recorder and is suppressed by the lane's own `dangerouslyIgnoreUnhandledErrors` before the recorder ever sees the report.

Acceptance:
`specs/features/BL-1619-the-property-lane-records-its-duration-and-names-its-pole.feature`.
