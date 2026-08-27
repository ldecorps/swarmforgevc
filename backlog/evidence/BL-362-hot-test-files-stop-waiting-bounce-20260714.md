# BL-362 QA bounce — 2026-07-14

## 1. Failing command (exact)

Isolated, apples-to-apples A/B timing of `extension/test/paneTailerClass.test.js`
before vs. after this parcel's fix, run from `extension/`:

```sh
git show ed1012fe^:extension/test/paneTailerClass.test.js > /tmp/old-paneTailerClass.test.js
cp /tmp/old-paneTailerClass.test.js extension/test/paneTailerClass.OLD.test.js
npx vitest run extension/test/paneTailerClass.OLD.test.js   # pre-fix file, run alone
npx vitest run extension/test/paneTailerClass.test.js       # post-fix file, run alone
```

(Also reproducible from the concurrent full-suite run: `npm test` inside `extension/`.)

## 2. Commit hash tested

`8018ac188724b1a4c49a8b1136f828e5da42064b` (QA's merge of the documenter's
handoff `c723372ada`, which itself carries `ed1012fe` — BL-362: dependencyGateCli
engine-boot consolidation; paneTailer tick injection — as an ancestor).

## 3. First error excerpt — measured timings, not a crash

Isolated (no concurrency contention), same container, same fixture:

```
pre-fix  (paneTailerClass.OLD.test.js, real setInterval default): 21 tests   3607ms
post-fix (paneTailerClass.test.js, injected fakeScheduler tick):  21 tests   3464ms
```

That is a ~4% delta — noise, not a fix. For comparison, the sibling file in the
same parcel *did* get a real fix:

```
pre-fix  (dependencyGateCli.OLD.test.js, 6 one-rule engine boots + whole-project scan): 18 tests  7195ms
post-fix (dependencyGateCli.test.js, merged single engine boot, scan relocated):        12 tests  3225ms
```

That is a genuine ~55% reduction — MECHANISM 2 (the engine-boot consolidation)
is correctly fixed. MECHANISM 1 (the pane-tailer tick injection) is not.

Root cause, confirmed by instrumenting `child_process.spawnSync` around a single
`tailer.start()`/`poll()` cycle: each poll cycle issues ~9 real `tmux`
invocations (`show-window-options`, 2x `set-option`, `resize-window`,
`has-session`, `list-windows`, `display-message` x2, `capture-pane`) through the
fake-tmux helper, and each invocation is a real `node` process spawn
(`test/helpers/fakeTmux.js`) costing ~15-20ms in this container — ~160ms per
poll cycle, independent of whether the interval is real or injected. A test
that drives 3-4 poll cycles pays ~500-700ms regardless of the scheduler. This
was true of the file *before* this parcel too (the isolated old-file run
above proves it), so the ticket's MECHANISM 1 diagnosis — attributing the
slowness to the real `setInterval` wait — was not the actual cost driver for
most of this file's tests; the real cost is fake-tmux subprocess-spawn count,
which this parcel did not touch.

Concurrent full-suite run (`npm test`) shows the same file still ranked #1 of
246 files by wall time (9054ms), with `dependencyGateCli.test.js` #2 (7972ms,
inflated by container CPU contention vs. its isolated 3225ms) — i.e.
`paneTailerClass.test.js` has *not* left the top of the per-file duration
ranking, contrary to the ticket's own E2E QA procedure requirement.

## 4. Failure class

`behavior` — the fix is structurally present (no `setInterval`/`setTimeout`
call remains in the test file; every `start()` call passes the injected
`scheduleTick`) but the ticket's own Scenario 5 acceptance criterion ("The two
files get materially faster … ") is unmet for `paneTailerClass.test.js`. This
is an intent/behavior mismatch, not a compile or unit-test failure — all 3400
unit tests pass green.

## 5. Expected vs. observed

Expected: `paneTailerClass.test.js` drops to milliseconds (ticket notes:
"Inject the tick everywhere; the file should drop to milliseconds") and no
longer appears near the top of the per-file duration ranking.

Observed: `paneTailerClass.test.js` is unchanged within noise (3607ms →
3464ms isolated) and remains the single slowest file in the suite (9054ms in
the concurrent run, #1 of 246). The real cost is per-poll fake-tmux subprocess
spawn count (~9 real spawns/poll cycle), not the real-timer wait the ticket
diagnosed and this parcel fixed.

## Scope note for the fix

`dependencyGateCli.test.js`'s fix is correct and should be kept as-is — do not
re-litigate MECHANISM 2. Only MECHANISM 1 (`paneTailerClass.test.js`) needs
further work: either reduce the number of real tmux subprocess spawns per
poll cycle in the test path (e.g. an in-process fake tmux client rather than a
spawned fake binary, or asserting `applyPaneSettings`/`refreshState` calls are
not repeated where avoidable), or the ticket's Scenario 5 wording needs the
human to re-scope it — but shipping it unfixed against the ticket's own stated
"drop to milliseconds" bar is not something QA can wave through silently.
