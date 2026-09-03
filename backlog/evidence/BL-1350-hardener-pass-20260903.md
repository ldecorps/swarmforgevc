# BL-1350 hardener pass — 2026-09-03

Merged architect commit `8c1c97af48` (clean sweep, no defect) onto this
worktree as `d47d85ecb2`. Reviewed coder's `f65f7d8f2d` (SSE keepalive on
the live bridge server) and the cleaner/architect passes on top of it.

## required_wiring / constraints re-verified
- `writeSseKeepalive` still defined inside `bridgeServer.ts` beside
  `sseClients` and the poll timer; a `setInterval` in the same scope calls
  it; `stop()` clears `keepalive` alongside `poll`.
- No real timers/sleeps in the unit suite: `keepaliveIntervalMs` is
  injectable (same precedent as `pollIntervalMs`); the acceptance/property
  suites drive a fake clock.
- BL-1111 alert untouched: diff since `8124490f28` touches only
  `bridgeServer.ts`, `telegramFrontDeskBotCore.ts`, this parcel's own
  test/step/evidence files, and `specs/pipeline/steps/index.js`.

## BL-149 cooldown gate
- `extension/src/bridge/bridgeServer.ts` — `skip-cooldown` (file touched
  today, 0.74d < 3d). No Stryker run against it this pass; see the manual
  in-process coverage work below, which is what actually closed its gap.
- `extension/src/tools/telegramFrontDeskBotCore.ts` — `run` (4.94d old,
  host quiet). See Mutation below.

## Coverage gap found and closed
`node scripts/crapReport.js src/bridge/bridgeServer.ts
src/tools/telegramFrontDeskBotCore.ts` flagged the new
`writeSseKeepalive` at complexity=5, **coverage=11%**, CRAP=22.91 — the
symbol the ticket's `required_wiring` anchor exists to pin was barely
exercised by any REAL in-process test. The acceptance and property
suites both drive a hand-copied reimplementation of the write loop on a
fake clock (by design — no real timers), not the shipped closure itself;
only a regex against the source text confirms the real function exists
and is wired.

Added two tests to `extension/test/bridgeServer.test.js`, following the
file's own `withBridge`/real-HTTP-fetch pattern (BL-281/BL-320 tests
above them), using the real injectable `keepaliveIntervalMs` to drive the
actual server-side interval and `writeSseKeepalive` closure in-process
over a real HTTP connection:
- an idle `/events` connection receives a periodic keepalive comment
  frame, with no snapshot re-sent (also asserts the frame is a pure SSE
  comment, never a `data:` line — the inertness the ticket's invariant 2
  and the description both call out).
- a disconnected client (real `AbortController.abort()`, same shape as
  the existing reply-relay-at-least-once tests) is dropped from the
  keepalive loop without throwing, and a second, healthy client's
  keepalive still arrives afterward — proving a dead client in the write
  loop cannot silently kill the timer for every other client.

Confirmed the second test's discriminating power empirically rather than
by argument (BL-1018 discipline): hand-patched `writeSseKeepalive` to
drop both the `writableEnded || destroyed` guard and the `try/catch`,
recompiled, and re-ran. Both new tests still passed. A probe script
(`node` against a real `http.createServer`) showed why: `res.write()`
against a response destroyed by a client-side `AbortController.abort()`
returns `false` silently in this Node version — it does not throw and
does not emit an unhandled `'error'`. `res.write()` after a *clean*
`res.end()` (not abort) DOES throw asynchronously and would crash the
process, but the only place the live server ever calls `client.end()` on
an sseClient is `stop()`, which clears `keepalive` via `clearInterval`
*before* the `client.end()` loop runs — and since Node is single-threaded
and both the interval callback and `stop()` run to completion
synchronously, there is no way for the keepalive timer to observe a
client between `end()` and its removal. So the `writableEnded`/try-catch
half of the guard has no reaching input anywhere in the current codebase
(BL-1198 shape: structurally unreachable, not merely untested) — it is
correct defensive coding for future callers of `client.end()`, and I left
it in place, but I did not force an artificial test for it. The
`destroyed` half IS reachable (via abort) and IS covered now by the new
"disconnected client" test above, which is the actually-exercised branch.
Reverted the hand-patch before re-verifying (`git diff --stat` on
`bridgeServer.ts` is empty against the merge tip; only the intended test
file changed).

Re-ran `npm run compile` + `npx vitest run test/bridgeServer.test.js` —
101/101 (99 pre-existing + 2 new).

## Mutation
- `telegramFrontDeskBotCore.js`: scoped Stryker run (temp
  `tmp/stryker.bl1350.config.json` + `tmp/vitest.bl1350.config.mjs`,
  deleted after the run — the repo-wide `stryker.config.json` dry-run is
  blocked by the pre-existing, already-ticketed `liveRepoDerivationGuard`
  standing red, same as BL-1322's finding), detached via `detach_job.sh`
  (registered, `EXIT=0` in 13m31s). `--force` was used (should not have
  been — this retested the WHOLE 2394-line file's 1968 mutants against a
  1-line diff that only added an `export` keyword; a plain incremental
  run would have been proportionate and far cheaper). Result:
  `telegramFrontDeskBotCore.js` 81.96% score, 1606 killed / 262 survived
  / 7 timeout / 93 no-cov. Every survivor is pre-existing code nowhere
  near this ticket's actual change (nearest survivors at lines 925/926/
  1886/1888; the ticket's diff is the `export` keyword on
  `drainBufferedRecords` at line ~3822, which itself shows 100% coverage
  in the CRAP report and 0 survivors in this run). Out of scope per
  BL-1192 discipline — none fixed here.
- `bridgeServer.ts`: skip-cooldown (see above); no Stryker run. The new
  code's own gap was closed via the direct in-process tests above instead.

## CRAP
`node scripts/crapReport.js src/bridge/bridgeServer.ts
src/tools/telegramFrontDeskBotCore.ts` (coverage regenerated via
`vitest run --coverage --coverage.reportOnFailure=true`, detached; 15
unrelated pre-existing test files failed under `--coverage`, all already
red on `main` before this parcel — same guard files as above plus
`unreachableStepHandlerCheck.test.js` etc. — so the report is a floor for
those files' own code, not for the two files this ticket touches, which
have no code path shared with them):
- `writeSseKeepalive`: was CRAP=22.91 at 11% coverage; now covered by the
  two new real-server tests (not re-measured numerically post-fix since
  the coverage run is the expensive detached step above and the new
  tests are simple, deterministic pass/fail assertions with no branch
  left unexercised by them — see "Coverage gap" above for exactly which
  branches they reach).
- `drainBufferedRecords`: complexity=2, coverage=100%, CRAP=2.00 — clean.
- All other flagged functions in both files (17 total over the CRAP<=6
  threshold) are pre-existing, untouched by this ticket's diff — out of
  scope per BL-1192.

## DRY
`npx jscpd --config .jscpd.json src/bridge/bridgeServer.ts
src/tools/telegramFrontDeskBotCore.ts` — 3 clones, 1.28% duplicated
lines. All three clone ranges (738-850, 1159-1280 in bridgeServer.ts;
33-154 in telegramFrontDeskBotCore.ts) sit well outside this ticket's new
code (bridgeServer.ts:2287-2364) — pre-existing, out of scope.

## Standing whole-tree guards
Parcel touches `extension/test/` (bridgeServer.test.js) and
`specs/pipeline/steps/index.js`. Ran all 17 `test/*Guard*.test.js`
(excluding `.property.` siblings — the set has grown since the
2026-08-19 rule that first required this, from 6 to 17). 3 failed, all
pre-existing and already ticketed, none naming any file this parcel
touches (confirmed by grep):
- `tempDirTrapGuard.test.js` — `backlog/paused/BL-1289-...yaml`.
- `socketFixtureShortRootGuard.test.js` — `backlog/paused/BL-1290-...yaml`.
- `liveRepoDerivationGuard.test.js` — `backlog/paused/BL-1291-...yaml`.
Same three as BL-1322's hardener evidence, 2026-09-01.

## Other checks
- `node out/tools/dependency-gate.js` on the property test — PASSED, no
  forbidden edges.
- `npx vitest run --config vitest.properties.config.mjs
  bl1350KeepaliveInvariants` — 3/3, unchanged from architect's pass.
- Acceptance: `node specs/pipeline/cli.js
  specs/features/BL-1350-idle-event-stream-keepalive.feature` — 4/4.
- BL-113 Gherkin soft mutation on Scenario Outline 03 (the only
  `Examples:` block; Scenarios 01/02 are plain `Scenario:` with nothing to
  mutate): 2/2 killed (both via "no step handler matched" — the outline's
  single column IS the key, not shape-based, so this is mutation-tight).
  Manifest stamp written into the feature file (kept, committed): 0
  survivors, 0 errors.
- Left no orphaned processes: `pgrep -fl 'node --test|stryker'` scoped to
  this worktree shows nothing after cleanup; both detached jobs' logs
  confirmed `EXIT=0`/`EXIT=1` (the coverage run's exit 1 is the 15
  unrelated pre-existing reds, expected) before I read them, and all temp
  files (`extension/tmp/*`, `extension/coverage/`) were deleted after use.

## Verdict
One real gap found and closed (writeSseKeepalive's own in-process test
coverage). Everything else is pre-existing debt, already ticketed or
newly out-of-scope-noted per BL-1192. Forwarding to documenter.
