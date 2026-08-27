# Coder-found — six unit-lane reds are full-lane load artifacts; every one clears in sequential isolation — 2026-08-21

Found while verifying BL-1002 (spec step 5 demands the full unit lane be
green and says a lane red for any other reason "must be reported, not
absorbed"). Reported here and by note to specifier+coordinator; NOT folded
into the BL-1002 parcel, which touches only `specs/pipeline/steps/`.

## Host at observation time

```
$ uptime            # during the full-lane run and first re-runs
 4:06  up 3 days, 16:08, 7 users, load averages: 158.79 145.22 129.62
$ uptime            # during the clean sequential isolation sweep
 4:27  up 3 days, 16:28, 7 users, load averages: 96.48 133.17 146.57
$ sysctl -n hw.ncpu   # (per BL-815 evidence, unchanged)
4
```

Load is 25-45x the core count throughout — the resident swarm's other
roles were live the whole time.

## The full-lane run (tmp/bl1002-unit-lane.log)

Started 03:52:16 local, duration 1650s. Result: 6 tests failed / 7991
passed, across 5 files:

| File | Failed test | Shape |
|------|-------------|-------|
| dependencyGateCliStorageGlobals.test.js | QA bounce repro: runGate flags a bare localStorage.setItem global | timeout, 20000ms suite default |
| renderBriefingDiagramsCli.test.js | compiled CLI standalone subprocess | timeout, 45000ms |
| briefingDigestLineCli.test.js | subprocess + snapshot-fallback cases (2) | timeout |
| bounceWatcher.test.js | startBounceWatcher wires real fs.watch into the debounce | timing (boundedWatchWait) |
| startBridgeHeadlessCli.test.js | compiled CLI standalone subprocess serves authorized route | timeout |

All five files consume `extension/` + `media/` sources; every failure is a
timeout/timing shape in a test that spawns subprocesses, watches the fs, or
drives a compiled CLI. None touches `specs/pipeline/steps/*`, BL-1002's
whole surface.

## First re-runs were CONTAMINATED — recorded so nobody trusts them

An earlier draft of this file re-ran two of the files "in isolation" at
04:04-04:15 and concluded isolation does NOT clear them. Those re-runs
overlapped the still-running full lane (03:52-04:19 on a 4-core box at
load ~150) — they were not isolation at all, and their FAIL results are
void. The durable lesson stands: isolation, not the timeout signature,
discriminates load — but only an isolation run that is actually alone.

## Clean sequential isolation sweep — ALL SIX CLEAR

One file at a time, nothing else launched by this session, 04:27-04:32
local, load ~92-135 (other swarm roles still live). Logs:
`tmp/bl1002-seq-isolation-batch1.log`, `...-batch2.log`, `...-diagrams.log`.

| File | Result | Duration |
|------|--------|----------|
| bounceWatcher.test.js | 35/35 PASS | 2.9s |
| startBridgeHeadlessCli.test.js | 13/13 PASS | 12.1s |
| dependencyGateCliStorageGlobals.test.js | 6/6 PASS | 30.1s |
| briefingDigestLineCli.test.js | 12/12 PASS | 43.8s |
| renderBriefingDiagramsCli.test.js | 4/4 PASS | 69.2s |

(The diagrams run also printed the known-benign `[vitest-worker]: Timeout
calling "onTaskUpdate"` artifact; every test passed.)

So the unit lane is green modulo full-lane host load: these are load
artifacts of running 452 files concurrently on a 4-core box at load
~150-180, not genuine reds and not BL-1002's.

## The real signal underneath — budget headroom has drifted (BL-999 class)

The pass durations are close to their budgets, and the trend under load is
one-way. The dependencyGate storage-globals test:

| When | Context | Duration | Result |
|------|---------|----------|--------|
| BL-948 lane run (tmp/bl948_npmtest.log) | full lane | 6386ms | PASS |
| BL-946 lane run (tmp/bl946_npmtest.log) | full lane | 8289ms | PASS |
| BL-815 classification 2026-08-17, load 47.8-50.4 | isolated | 10746ms | PASS |
| BL-1003 refix lane (tmp/bl1003-npmtest-refix.log, mtime Aug 21 02:05 local — 29min BEFORE BL-1002's first commit 8036b7565 at 02:34) | full lane | 28852ms | FAIL |
| BL-1002 lane run | full lane | 21379ms | FAIL |
| Clean isolation 04:27, load ~100 | isolated | ~26s file total | PASS |

A 20000ms budget that a healthy pass consumes ~26s of file runtime against
under today's normal swarm load has no headroom left; renderBriefingDiagrams
passes at 31s against a 45s budget. BL-815 already classifies
renderBriefingDiagramsCli as load-flaky. BL-999 ("a test budget is
justified, not merely present", paused, human-approved) is exactly this
defect class, scoped to `renderBriefingBurndownCli.test.js` and the BL-969
guard. These five files are further instances; whether they fold into
BL-999 or mint their own ticket is the specifier's call — that is the
note's purpose.

## Why none of this is BL-1002's

- Every red is in `extension/test/`, consuming `extension/` + `media/`
  sources; BL-1002 touches only `specs/pipeline/steps/*` (fixture-root
  plumbing and its own new step handler).
- The dependencyGate red is present in a full-lane log whose mtime (Aug 21
  02:05 local) precedes BL-1002's first commit (02:34) by 29 minutes.
- Everything BL-1002's own surface gates on is green at these same load
  readings: socketFixtureShortRootGuard 16/16, all 11 non-property
  `test/*Guard*.test.js` files 81/81 (tmp/bl1002-guards-final.log, on the
  final parcel content), BL-1002 acceptance 5/5
  (tmp/bl1002-acceptance-after.log, RC=0).

By coder.
