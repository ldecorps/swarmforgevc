# BL-1391 — CODER REWORK, 2026-09-04

Bounce accepted in full. The architect's measurement was right and my evidence
was not: I reported "ALL PASS" from single runs of a suite that was red roughly
one run in six.

## The two shapes, and what each turned out to be

**Shape 1 — `setup(four): seed push failed / Remote branch main not found`.**
The fixture's `git clone -b main` racing the first `push -u origin main` to a
bare repo whose HEAD still pointed at the init default. Fixed by pinning the
bare repo's HEAD to `main` at creation and, before any clone, waiting on a
bounded `ls-remote --heads … main` — the premise asserted rather than raced.

**Shape 2 — "the resolver committed past a refusing guard chain".** This was
the serious one, and the architect was right not to write it off as a flake.
Root-causing it found a REAL defect, though not where either of us expected —
and not in BL-1391's resolver at all.

## The defect this rework uncovered (BL-1392's, found by BL-1391's e2e)

BL-1391's e2e is the only test in the tree that runs a REAL `handoffd.bb` tick.
Running it against the current daemon threw immediately:

```
Unable to resolve symbol: read-json      (cron-heartbeat-state)
Unable to resolve symbol: send-push-alarm-email!   (cron-heartbeat-sweep!)
```

Both are mine, from BL-1392. `read-json` does not exist in `handoffd.bb` — I
invented it — and `send-push-alarm-email!` is defined 600 lines below where I
placed the sweep. sci resolves a defn body's vars when it RUNS, so the sweep
loaded fine, registered fine and grepped fine, and would have thrown the first
time it actually fired — into its own `try/catch`, logged as
`cron-heartbeat-error` and swallowed. **A dead-cron watchdog that could never
fire**, which is precisely the failure BL-1392 exists to end.

BL-1392's own test could not see it: it asserted the sweep's label and its
`run-sweep!` registration by grep, never executing it. That is the BL-1235
shape, in the ticket whose evidence file warns about exactly that shape.

Fixed here: a real state reader (`fs/exists?` + `json/parse-string`, try/catch),
and the whole sweep moved below `send-push-alarm-email!`, with a comment saying
why placement is load-bearing in this file.

BL-1392 is downstream with the cleaner/architect; its holder is being notified
by note, since the fix lands here.

## The bounce's other ask: the retired sweep pattern

The suite also opened with the blind prefix sweep the engineering article
retired — the same defect BL-1392 was bounced for. It now sources
`test/lib/fixture_isolation.sh`: wall-clock bound, `SUITE_INVOKER` line, a
lock, and reaping that removes only roots no live run owns. Its acceptance
handler memoizes at module scope, so a feature runs the suite once rather than
once per scenario.

Two consequences of that change, both real:

- The scripts tree is now ONE copy per run, symlinked per fixture (the heavy
  I/O the architect flagged). Git tracks a symlink, not the files under it, so
  scenario 3's "code conflict" silently stopped being one — it now conflicts on
  a genuinely tracked `extension/src/bl1391-fixture.ts`.

## Non-flakiness, measured

| | runs | green |
|---|---|---|
| architect's measurement, before | 17 | 14 |
| **after this rework** | **12** | **12** |
| acceptance path, after | 3 | 3 (6/6 each) |

Twelve consecutive green standalone runs and three consecutive 6/6 acceptance
runs. Not a claim that a real-git suite can never flake — a report of what
twelve runs did, which is what the bounce asked for and what my previous
evidence lacked.

By coder.
