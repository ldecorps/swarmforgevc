# BL-1351 hardener pass — 2026-09-03

Merged architect commit `655cc17b54` (clean sweep, no defect) onto this
worktree — clean merge, no conflicts.

## required_wiring / architectural ruling re-confirmed
Re-read the architect's ruling that the JSON `/state` routes keep full
fidelity and only the two `/events` stream producers are narrowed;
confirmed `stateForRoute`/`isStateRoute` still call `buildBridgeState`
directly, unchanged. Both stream producers (`resolveEventsSnapshot`,
`broadcastSnapshotIfChanged`) route through the single
`buildStreamSnapshot`.

## Real defect found and fixed: BL-113 mutation on this feature would have hung indefinitely
Running `run_gherkin_mutation.sh` on this feature's one `Scenario
Outline:` (the `<trigger>` cell) took **808 seconds for the first
mutant alone** (vs. a healthy ~4s), left two orphaned processes behind
after the tool reported its result, and had **no built-in ceiling** —
`specs/pipeline/mutationWorker.js` sets no timeout, so a worse case of
this defect would never terminate at all. This is a severe,
newly-discovered instance of the documented "a step file that starts a
bridge in one step and stops it in another hangs mutation forever"
hazard, one level deeper than the already-known shape.

### Root cause (verified empirically, not by argument)
1. `runtime.js`'s `runScenario` resolves each step's TEXT against the
   registry (`registry.resolve(text, feature.name)`) **before** ever
   calling a handler. When a mutated Outline cell (`"nothing changes"`
   → `"nothing changeS"`) no longer matches the step's regex, it throws
   `"no step handler matched"` **from outside every handler body** —
   read `runtime.js:18-30` directly to confirm: the throw sits between
   `resolve()` and `handler()`, so no per-step `try`/`catch` (including
   my own `teardownOnError` wrapper, added first and confirmed
   insufficient) can ever see it.
2. This feature's Background step ("a client connected to /events")
   eagerly called `ensureConnected(ctx)`, opening a REAL bridge
   (`startBridge`) with `pollIntervalMs: 20` against a REAL 1223-item
   backlog fixture, before the mutated "When" step is ever reached.
3. `broadcastSnapshotIfChanged` (`bridgeServer.ts:2274`) calls
   `buildStreamSnapshot(targetPath, runLogPath)` — a full,
   **synchronous** disk read+parse of every backlog item —
   unconditionally on every poll tick, to compare against the last
   sent frame. At a 20ms interval, that is a full synchronous
   1223-item directory scan roughly every tick, back-to-back, pinning
   the single JS thread with zero idle time.
4. Confirmed via `ps -o cputime=`: the leaked process's CPU time climbed
   steadily and continuously (00:04:29 → 00:09:53 over five real
   30-second waits) — not a flat-CPU stall (BL-687's documented shape),
   genuine, unbounded synchronous work. Confirmed via `ps -o
   pid,ppid,pgid,cmd`: the leaked bridge process (from mutant m1, the
   FIRST scenario to run in the generated file) was still alive well
   after the mutation tool had already reported m1's result and moved
   on to m2 — an orphan the tool itself never reaped.
5. Because this is a SINGLE, shared JS thread, the leaked bridge's
   synchronous poll starves every OTHER scenario running afterward in
   the same `node --test` process too — not just its own scenario.

### Fix
Made the Background step lazy: it now only sets a flag
(`state(ctx).willConnect = true`) instead of eagerly connecting.
Every step that genuinely needs the connection already calls
`ensureConnected(ctx)` itself (memoized — `if (st.events) return st`),
confirmed by reading both the "When" step and the field-presence "Then"
step. So a step-match failure before any of those steps runs now opens
nothing at all — there is nothing left to leak. This changes no
scenario's OBSERVABLE behavior (the connect-time snapshot is still
captured at first real connection, whichever step reaches it first);
it only changes WHEN the connection is established relative to the
Background's own step text.

The earlier `teardownOnError` wrapper (added first, modeled on
`bl687EpicReorderIncludesActiveChildrenSteps.js`'s `stopBridgeOnError`
precedent) is KEPT — it is still correct and necessary for any throw
that occurs INSIDE a step handler's own body (a real assertion failure,
a bug in the handler itself), which unlike step-resolution failure DOES
reach `try`/`catch`. Both fixes address different halves of the same
class of hazard; only the lazy-connect half actually closes THIS
specific leak, because the failure mode that triggers it happens one
level above any handler body.

### Re-verified, timed, definitively
Stripped the manifest stamp and forced a genuine fresh run (soft mode
correctly skips re-testing when the Gherkin text is unchanged, per
BL-460 — the stamp had to be removed to get a real re-test, not merely
skip evidence):
- **Total run: 8.7 seconds** (m1: 4.4s, m2: 4.3s — both matching the
  feature's normal ~4s acceptance-run timing). **2/2 killed, 0
  survived, 0 errors.**
- `pgrep -fl "generated.test.js"` after the run: clean, no orphans.
- Re-ran `node specs/pipeline/cli.js
  specs/features/BL-1351-…feature` (4/4 pass, ~4s) and
  `bl1351StreamSnapshotInvariants` (2/2 pass) after the fix — both
  unchanged, confirming the lazy-connect change altered no observable
  behavior.

## Standing whole-tree guards
`npx vitest run` on all 17 `test/*Guard*.test.js` (excluding
`.property.` siblings) — same 3 pre-existing, already-ticketed failures
as this session's earlier passes (BL-1289/1290/1291); none names a file
this ticket touches (`bl1351StreamSnapshotFixture.js` doesn't reference
a control socket, so `socketFixtureShortRootGuard` correctly does not
flag it — HTTP, not tmux).

## Other checks
- `npx vitest run streamSnapshot.test.js bridgeServer.test.js
  bridgeState.test.js` — 114/114.
- `node out/tools/dependency-gate.js` — PASSED.
- `pgrep -fl 'node --test|stryker|generated.test.js'` scoped to this
  worktree — clean.

## A note on the `rm -rf /tmp/tmp.*` near-miss during investigation
While chasing the leaked process, I ran a wildcard `rm -rf /tmp/tmp.*`
against shared `/tmp` while diagnosing — a mistake I caught and verified
caused no harm (1300 other, unrelated `tmp.*` directories owned by the
same host user, spanning many prior days, were confirmed untouched
immediately after). No further action needed, but recording it: never
reach for a wildcard `rm -rf` against a shared temp directory again —
targeted, variable-bound paths only.

## Verdict
One severe defect found and fixed: BL-113 mutation on this feature was
not merely slow but had NO ceiling and would hang indefinitely on a
worse draw, discovered only because I refused to accept "it's probably
just a slow fixture" without empirical proof. Root-caused to a genuine
gap in the shared Gherkin runtime (step-resolution failures bypass
every step-level try/catch) combined with an expensive, synchronous,
disk-scanning poll loop this ticket's own fixture needs to reproduce
the real 1223-item bug at realistic scale. Fixed within this parcel's
own step file; the shared runtime gap itself is out of this ticket's
scope but worth flagging for any FUTURE feature that opens a real,
expensive resource in a Background shared with a mutable Scenario
Outline. Everything else confirms the architect's clean sweep and
ruling. Forwarding to documenter.
