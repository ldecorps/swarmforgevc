# BL-2027 architect bounce (2026-10-06)

## Reviewed commit

47672afd7d (BL-2027: the recorded lane runner ...)

## D1 — `run_recorded_lane.sh` reports a passing item as failed when an earlier item in the list failed (correctness, violates declared invariant 2)

`st` is a script-scoped variable, never reset at the top of the loop
(`swarmforge/scripts/test/run_recorded_lane.sh:41-50`):

```
while IFS=$'\t' read -r item cmd || [ -n "$item" ]; do
  ...
  t0=$(date +%s%3N)
  bash -c "$cmd" || st=$?
  st=${st:-0}
  ...
```

`st=$?` is only assigned on the `||` branch, i.e. only when the command
fails. When a LATER item's command succeeds, `st` is never reassigned, so
it keeps the FAILING status left over from whichever earlier item last
failed. `st=${st:-0}` does not help: `st` is non-empty (it holds the
stale failing code), so the default never kicks in.

Reproduced directly against the committed script, outside any fixture
(list: `a` -> `false`, `b` -> `true`, run in that order):

```
$ bash swarmforge/scripts/test/run_recorded_lane.sh --lane fixture \
    --list list.tsv --durations durations.jsonl
passed 0 failed 2
FAILED a
FAILED b
```

`b` (`true`, exit 0) is reported as failed and gets a `"result":"fail"`
row, even though it exited 0. This directly violates the ticket's own
declared invariant 2 ("each item's own exit status - observation only")
and corrupts the duration log's `result` field for every item that
follows a failure in the list.

The acceptance feature does not catch this because both of its fixed
shapes put the passing item FIRST and the failing item LAST
(`KNOWN_SHAPES` in `bl2027RecordedLaneRunnerVerdictSteps.js:18-21`: `a`
always `true`, `b` is the one that varies) — the only order that happens
to work. A fail-then-pass sequence, which is exactly the shape BL-2020/
BL-2021 will drive this runner over in production (any lane with more
than one red followed by a green), silently mis-reports every passing
item after the first failure.

**Remediation**: reset the per-item status before running the command,
e.g.

```
st=0
bash -c "$cmd" || st=$?
```

(declare `st` at loop entry, not just read with `:-0` after the fact), so
each iteration's status reflects only that iteration's own command. Add a
third shape/scenario (or extend the existing KNOWN_SHAPES) covering
fail-then-pass so this class of bug cannot regress silently.

## Checks completed, no other findings

- Dependency gate (`extension/out/tools/dependency-gate.js`): PASSED, no
  forbidden edges, run against the step handler.
- Co-change report (`extension/out/tools/co-change-report.js`): the two
  new files co-change only with each other — no suspected coupling.
- Invariant 1 ("every completed item appends exactly one row, an
  incomplete one appends none"): holds as far as exercised; the runner's
  `>>` append is per completed item and unconditional on pass/fail, and
  scenario 05 exercises the `--limit` truncation. No property test exists
  for either invariant and none is warranted here — the subject is a bash
  script's process behavior across multiple real subprocess invocations
  per run, not a pure JS function `fast-check` could quantify over; the
  acceptance feature plus this hand-verification are the appropriate
  encoding. Invariant 2 is VIOLATED per D1 above.
- Everything else (script argument parsing, `--limit` truncation, exit
  status propagation on an unconditional failing run, verdict
  formatting/`slowest`/`wall` lines, step handler's use of
  `trackedTmpRoot`/no manual cleanup, `registerSteps`/`module.exports`
  shape per BL-233/BL-1371): reviewed, no defect found.

## Routing

D1 is a correctness defect in `run_recorded_lane.sh` itself — bounced to
**coder**. Not forwarded to hardener.
