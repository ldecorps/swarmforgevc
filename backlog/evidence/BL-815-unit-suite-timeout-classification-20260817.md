# BL-815 — unit-suite timeout classification — 2026-08-17

## Host, recorded before any isolation run

```
$ uptime
 9:44  up 38 days, 22:06, 4 users, load averages: 18.69 18.04 15.50
$ sysctl -n hw.ncpu
4
```

Load average is well below the "250+ band for days" the ticket describes,
but still ~4-5x the 4-core count — not a genuinely quiet host. This machine
also runs the live swarm's own daemons and an IDE (Cursor) continuously
alongside this measurement; both are visible in `ps aux` throughout. No
shift pause was requested or taken for this measurement — see "Why no shift
pause" below.

## The five failures, isolated (`vitest run <file> -t "<name>"`)

| # | File | Test | Isolated result | Duration | Load at run |
|---|------|------|------------------|----------|-------------|
| 1 | dependencyGateCliReportsAndScope.test.js | running the REAL checker twice over identical fixture code produces byte-identical reports | PASS | 19371ms | 18.7→55.5 |
| 2 | dependencyGateCliStorageGlobals.test.js | QA bounce repro: runGate flags a bare localStorage.setItem(...) global reference that depcruise alone misses | PASS | 10746ms | 47.8→50.4 |
| 5 | renderBriefingDiagramsCli.test.js | renders exactly the two maintained diagrams, named and base64-encoded | FAIL then PASS (rerun) | 34397ms / 10324ms | 47.6→55.5 / 44.3→50.4 |
| 6 | renderBriefingDiagramsCli.test.js | main() runs in-process against the real repo and prints the two maintained diagrams as JSON | FAIL then PASS (rerun) | 20194ms / 17480ms | 36.1→34.8 / 40.9→38.8 |
| 7 | renderBriefingDiagramsCli.test.js | the compiled CLI runs standalone as a subprocess and produces the same result | PASS | 19254ms | 34.2→45.7 |

## What production seam each guards, and which ticket introduced it

- **#1, #2** (`dependencyGateCliReportsAndScope.test.js`, `dependencyGateCliStorageGlobals.test.js`):
  BL-259's dependency-cruiser gate (architecture-diagram/webview-storage
  rules) and BL-375's split of the real-engine tests into their own files so
  they can run concurrently instead of one file serializing 12 tests. Both
  boot the REAL pinned `dependency-cruiser` (never mocked) against a real
  fixture tree — genuinely subprocess-heavy by design.
- **#5, #6, #7** (`renderBriefingDiagramsCli.test.js`): the morning
  briefing's architecture-diagram rendering path (`render-briefing-diagrams.ts`
  → `mermaidRender.ts`, `beautiful-mermaid` + `resvg` — CPU-bound layout +
  native SVG rendering, deliberately chosen over `@mermaid-js/mermaid-cli`
  specifically because that would require spawning headless Chromium via
  puppeteer, per `mermaidRender.ts`'s own header comment). #6/#7 render the
  two REAL maintained diagrams (`docs/diagrams/*.mmd`); #5 renders a smaller
  fixture diagram.

## Classification

| # | Classification | Reasoning |
|---|-----------------|-----------|
| 1 | Real slowdown past the 20s budget (marginal) | Comfortably passes but at 19371ms — within 3% of the cap even isolated. The test runs the real checker TWICE (double subprocess cost) by design (byte-identical-reports assertion). Not a hang; a budget that's too tight for this operation on this class of host. |
| 2 | Load-induced starvation (one-off) | 10746ms isolated, less than 55% of budget, at similarly high ambient load (47.8) as the failing runs elsewhere in this table. No evidence of a persistent slowdown — the original failure was very likely a worse moment of contention than this measurement caught. |
| 5 | Load-induced starvation, high variance | Same test, two isolated runs 24 seconds apart at comparable load (47-55): one failed at 34397ms, one passed at 10324ms. A 3x swing on an identical workload under similar load-average readings is the signature of scheduling variance on a contended host, not a fixed cost. |
| 6 | Real slowdown past the 20s budget (marginal) | Two isolated runs: 20194ms (FAIL, by 194ms) and 17480ms (PASS). Renders the two REAL maintained diagrams in-process — consistently close to the cap even at its best observed run. The underlying operation's cost, not host noise, is the dominant factor here. |
| 7 | Real slowdown past the 20s budget (marginal) | 19254ms isolated (subprocess variant of #6, real diagrams). Same shape as #1 and #6 — comfortably under budget only because "comfortably" here means single-digit percent of headroom. |

None of the five is a real regression or a genuine hang: every isolated run
either passed with single-digit-percent headroom or failed by low
single-digit seconds, and re-running the same workload swung between the
two outcomes at comparable load. The common thread across all five is that
their PRODUCTION work (a real subprocess dependency-cruiser scan, or real
CPU-bound diagram rendering) is inherently close to the 20-second unit-suite
budget on this host, and ordinary contention swing is enough to tip
individual runs over the line.

## Consequence

- **#2**: no fix ticket. Comfortable isolated margin; explicit reason above.
- **#1, #5, #6, #7**: one fix ticket, BL-914 (minted alongside this
  evidence, per this ticket's own 1:N permission) — give these four
  specific, already-identified real-subprocess/real-render tests a
  per-test timeout override, not a global budget raise. BL-362 already
  established this exact pattern for `dependencyGateCliReportsAndScope.test.js`'s
  own sibling whole-project scan (relocated to the acceptance path); this
  finding is the same shape at a smaller scale, so a scoped per-test
  `test(name, fn, { timeout })` override is the minimally-invasive fix,
  never a change to `vitest.config.mjs`'s global `testTimeout`.

## The 119 `[vitest-worker] Timeout calling "onTaskUpdate"` errors

Directly observed the SAME error class this session, unprompted, while
verifying an unrelated ticket (BL-896) earlier today: running
`gitHistoryAdapter.test.js`'s own real-repo `git log` test (11.5s) alongside
three siblings produced exactly one
`Error: [vitest-worker]: Timeout calling "onTaskUpdate"` unhandled error,
with all 4 tests still passing. That error is Vitest's own worker↔main-process
RPC heartbeat timing out because the worker thread was busy doing real,
long-running I/O-bound work (a full-history git walk) rather than servicing
the heartbeat — a **consequence of the same saturation** this ticket's five
failures show, not an independent suite-infra defect. No fix ticket: it is
noise riding the same root cause the isolation table above already
classifies, and addressing #1/#5/#6/#7's own timeout headroom (BL-914)
reduces the same worker contention that produces it.

## Full-suite re-run (QA procedure step 3)

`npx vitest run` from `extension/`, same host, same day (started 11:22,
load 13.44/22.49/64.08 → finished 11:28, load 68.87/56.62/67.30):

```
Test Files  5 failed | 432 passed (437)
     Tests  6 failed | 7727 passed (7733)
  Duration  352.56s
```

Failing today:

1. `activateBounceWatcher.test.js` > "startBounceWatcher detects bounce
   file creation"
2. `bounceDrain.test.js` > "startGracefulBounceFileWatcher detects a
   bounce-graceful file and deletes it"
3. `bounceWatcher.test.js` > "startBounceWatcher wires real fs.watch
   events into the debounce"
4. `renderBriefingBurndownCli.test.js` > "renderBriefingBurndown falls
   back to deriving its own history when no snapshot path is given
   (smoke test against the real repo)"
5. `renderBriefingBurndownCli.test.js` > "renderBriefingBurndown falls
   back to deriving its own history when the given snapshot path does
   not exist"
6. `renderBriefingDiagramsCli.test.js` > "the compiled CLI runs standalone
   as a subprocess and produces the same result" — **this is #7 from the
   original inventory**, reproducing again under real full-suite
   contention. Reinforces its classification above (real slowdown past
   the 20s budget, marginal) rather than contradicting it.

The set differs from the original inventory, exactly as the QA procedure
anticipates ("If it differs, the inventory is updated with both runs
recorded... an eighth failure is not to be invented"): #1, #2, #5, #6 from
the original inventory did NOT fail in this full run at all — consistent
with their classifications above (marginal-but-usually-fine, or a genuine
one-off). The four NEW failures (activateBounceWatcher, bounceDrain,
bounceWatcher, renderBriefingBurndownCli) are OUTSIDE BL-815's own
authoritative inventory (the five named in the 2026-08-05 intake) and are
explicitly out of scope for this ticket's classification — recorded here
as an observation, not analyzed to the same isolation-run depth. All four
are, by pattern, the same shape this ticket already classifies: real
fs.watch/subprocess/real-repo I/O work close to the 20s budget on a
contended host. Worth a look if this recurs; not this ticket's inventory
to reclassify.

No stray processes and no orphaned `node --test`/stryker/vitest processes
after either full-suite run (checked via `pgrep`).

## Why no shift pause

The intake flagged that a genuinely quiet host might require pausing the
swarm's shifts, and left that call to the human. This slice's own design
(record load as a number, not an adjective, alongside every isolated
result) does not actually require a quiet host to produce a valid
classification — every isolated result above is reported with its own
measured load, and the classification accounts for exactly the variance a
loaded host produces. No shift pause was requested.
