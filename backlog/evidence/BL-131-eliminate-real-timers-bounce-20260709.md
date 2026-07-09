# BL-131 QA bounce — suite-speed-02 not met: swarmOrchestrator.test.js's real
# multi-second sleeps dominate the whole suite's wall clock, unexamined

## Failing command
```
cd extension && npm run compile && node scripts/recordTestDuration.js
```

## Commit hash tested
`974050f9d8` (documenter's handoff, `BL-131-eliminate-real-timers`), merged
into QA at `8a8d332c4a`.

## First error excerpt
Full-suite duration is consistently ~16.4-16.5s (measured across 3 separate
runs at this commit), essentially unchanged from before the ticket landed.
Per-file breakdown (only files >=200ms shown):

```
✓ test/swarmLauncher.test.js (42 tests) 1767ms
✓ test/paneTailerClass.test.js (20 tests) 4572ms
✓ test/tmuxClient.test.js (50 tests) 4702ms
✓ test/swarmOrchestrator.test.js (31 tests) 16047ms   <-- dominates
...
Duration  16.47s (... prepare 9.76s)
```

`test/swarmOrchestrator.test.js`'s own reported duration (16047ms) is within
noise of the ENTIRE suite's wall-clock duration (~16.4-16.5s) — because
Vitest parallelizes across files, the slowest file's own duration IS
effectively the suite's wall-clock floor. This one file is the bottleneck.

The two tests responsible (`extension/test/swarmOrchestrator.test.js:296`
and `:337`) each write a real shell script and spawn it:

```js
fs.writeFileSync(swarmScript, '#!/bin/sh\nsleep 10');
...
const result = await orchestrateFullLaunch(targetPath, {}, 10);
```
```js
const content = `#!/bin/sh
mkdir -p .swarmforge
echo "/tmp/fake.sock" > .swarmforge/tmux-socket
sleep 5`;
...
const result = await orchestrateFullLaunch(targetPath, {}, 50);
```

Each test does not return until the real `sleep 10` / `sleep 5` finishes on
the real OS clock, regardless of `orchestrateFullLaunch`'s own tiny
(10ms/50ms) timeout firing promptly — a real wall-clock wait by construction.

## Failure class
`behavior`

## Expected vs observed
Expected (ticket's own acceptance, `BL-131 suite-speed-02`): "a full unit
test run completes in on the order of a few seconds, not tens of seconds,
for the same or larger test count." `no-real-timers-01` also states
unconditionally: "no test file under extension/test waits on the real
clock."

Observed: the suite still takes ~16.5s — not "a few seconds" by any
reasonable reading — because `swarmOrchestrator.test.js` still contains two
tests that wait on a real multi-second OS-level `sleep`, the same
real-wall-clock-wait pattern the ticket's title and no-real-timers-01 target.
This file is not in the ticket's own "evidence" grep list (`setTimeout|
setInterval|await new Promise.*setTimeout` — a shell `sleep` inside a
spawned fixture script doesn't match that pattern), and — unlike
`swarmLauncher.test.js` and `paneTailerClass.test.js`, whose residual
latency the hardener explicitly investigated and documented as legitimate
OS-level subprocess-spawn cost, not a missed fake-timer opportunity —
`swarmOrchestrator.test.js` was never mentioned by the coder or the
hardener at all. The hardener's own commit message states "~16.5s wall
clock ... confirms the ticket's actual goal was met," but 16.5s is not
"a few seconds," and the breakdown above shows why: fixing just these two
tests would cut the suite's wall-clock bottleneck from ~16.5s down to
whatever the next-slowest file is (~4.7s), which is much closer to what the
ticket actually promises.

Note for whoever picks this up: unlike the already-fixed files, this test's
comment (`swarmOrchestrator.test.js:340-347`) documents that the real sleep
is a stand-in chosen because `orchestrateFullLaunch`'s `kill()` only signals
the direct shell child, not a forked `sleep` grandchild — a pre-existing
process-tree-kill limitation from BL-121 hardening, not simply a missing
fake-clock injection. The fix may need either (a) the same
scheduleTick-injection treatment applied to these two tests plus whatever
`orchestrateFullLaunch` internals let the test observe the timeout without
waiting for the real child to die, or (b) if that's a materially separate,
deeper fix, an explicit re-scope of BL-131 (documented, like BL-142's
slice-1 pattern) plus a dedicated follow-up ticket for the kill()
reliability issue — but it should be a conscious decision, not a silent
gap the acceptance criterion papers over.
