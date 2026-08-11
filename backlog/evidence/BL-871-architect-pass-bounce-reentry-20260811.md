# BL-871 — architect pass, bounce re-entry — 2026-08-11

## Scope reviewed

Parcel received from cleaner at `79db75ce47` (merge of `184f6ac467` into
swarmforge-cleaner), forwarding the coder's bounce-reentry fix at
`184f6ac467`'s ancestor chain back to the coder's own commit addressing
QA's bounce (`backlog/evidence/BL-871-bounce-20260811.md`, commit tested
`052a1f4f0c`). The same merge commit also carries BL-877 (a different,
unrelated ticket promoted and coded concurrently); not reviewed here — out
of this task name's scope, left for its own parcel.

Files touched by this bounce-fix, per `git diff 052a1f4f0c..79db75ce47`
scoped to BL-871: `extension/vitest.properties.config.mjs`,
`extension/test/bl760DuplicateChainGuard.property.test.js`,
`extension/test/bl787NamedTunnelInvariants.property.test.js`,
`extension/test/bl797MutationGateProbeCrashFallback.property.test.js`,
`specs/pipeline/steps/bl871PropertyLaneWorkerPoolCapSteps.js`. Verified
each changed line against the coder's own evidence
(`backlog/evidence/BL-871-coder-pass-bounce-reentry-20260811.md`) by
reading the diff directly, not taking the writeup on word.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` (paths relative to
`extension/`) against the five files above: **PASSED, no forbidden edges.**

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against the same five
files: one pair at or above the suspected-coupling threshold —
`bl787NamedTunnelInvariants.property.test.js` ↔
`specs/pipeline/steps/index.js` (3 co-changes). This is the step-registry
pattern every ticket with a new/changed feature file trips (see my prior
BL-871 pass's note on `index.js`'s near-universal high co-change count);
not new, not attributable to this bounce-fix. No coupling defect found.

## Invariants review (BL-654)

Neither declared invariant's own property test
(`bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`) or its guard
(`workerPoolConfigGuard.js`) is touched by this diff — confirmed via `git
diff 052a1f4f0c..79db75ce47 --stat -- extension/test/bl871PropertyLaneWorkerPoolCapInvariants.property.test.js`
(empty). Both were independently confirmed non-vacuous in my prior pass
(`BL-871-architect-pass-20260811.md`) and QA's own bounce evidence
separately re-confirms invariant 1's property "passes cleanly every run,
including inside the acceptance run" — unaffected by this bounce.

Re-checked invariant 2 ("neither lane carries its own copy of the worker
ceiling or heap numbers") against the new config text by hand:
`dangerouslyIgnoreUnhandledErrors: true` and the raised `testTimeout`s are
not worker-ceiling/heap numbers — `workerPoolConfigGuard.js`'s
`hasHardcodedMaxForks`/`hasHardcodedHeapSize` regexes (`maxForks\s*:\s*\d`,
`--max-old-space-size=\d`) do not match either new line. Invariant 2 holds.

## D1 (acceptance scenario 04 timeout) — verified

`bl871PropertyLaneWorkerPoolCapSteps.js:147`: `spawnSync` timeout raised
300000 → 900000. Matches evidence exactly.

## D2 (subprocess-heavy files still timing out) — verified

`SUBPROCESS_HEAVY_TIMEOUT_MS = 240000` added to all three named files
(`bl760DuplicateChainGuard`, `bl787NamedTunnelInvariants`,
`bl797MutationGateProbeCrashFallback`) and passed as the vitest per-test
timeout arg to every `test(...)` call in each file — confirmed by reading
each call site, not just the constant declaration. Inner `spawnSync`
timeouts doubled 15000→30000 at every site QA's own evidence and the
coder's writeup name. `bl787`'s launcher poll budget
(`SWARMFORGE_NAMED_TUNNEL_WAIT_ATTEMPTS`/`_INTERVAL`) widened 40×0.05s=2s
→ 200×0.1s=20s, still well inside `SUBPROCESS_HEAVY_TIMEOUT_MS` and still
faster than the real launcher's own 45s production default. Correctly
wired.

## Third mechanism (dangerouslyIgnoreUnhandledErrors) — verified, one
## residual risk assessed and judged not send-back-worthy

Confirmed `dangerouslyIgnoreUnhandledErrors` is a real, typed Vitest
config option (`node_modules/vitest/dist/config.d.ts`), not a fabricated
flag. Read Vitest's own bundled source
(`node_modules/vitest/dist/chunks/cli-api.DWGBtMmz.js:9894`) directly:
`_checkUnhandledErrors` does exactly what the coder's evidence claims —
`if (errors.length && !this.config.dangerouslyIgnoreUnhandledErrors)
process.exitCode = 1`, gating only the exit-code side effect, never the
"Unhandled Errors" section's own printing.

Assessed residual risk beyond what the coder's own writeup already flags:
Vitest exposes no narrower, message-filtering hook anywhere in its public
config or reporter surface — checked `config.d.ts` and the worker RPC's
`onUnhandledError` signature directly; it is a plain notifier, not a veto
point. That means going forward, this flag is genuinely all-or-nothing: a
FUTURE, functionally different unhandled error in the property lane (e.g.
a stray unawaited rejection in test-helper teardown) would also no longer
flip the run's exit code. `bl871PropertyLaneWorkerPoolCapSteps.js`'s own
acceptance assertion (`every property file reaches a verdict without
timing out`) checks only `ctx.result.status`, not the captured output's
content, so this specific automated gate would not catch it either — only
a human reading full console output would.

Judged NOT a send-back: (1) a thrown assertion inside a test body still
fails that specific test via Vitest's normal per-test try/catch, entirely
independent of this flag — the residual gap is narrower than "any bug is
masked", it's specifically errors that occur outside the synchronous test
body; (2) the flag is scoped to the property lane only, confirmed absent
from `vitest.config.mjs` (`grep dangerouslyIgnoreUnhandledErrors
extension/vitest.config.mjs` — no match), so the unit lane's own coverage
of async-teardown bugs is untouched; (3) no narrower mechanism exists in
Vitest's public API to do better, so this is the available tradeoff, not
a coding mistake; (4) it is transparently documented in-line for future
maintainers, not silently swept. Filing a `rule_proposal` (separate from
this handoff, non-blocking) suggesting a supplementary grep of the
captured output for any "Unhandled Error"/"Unhandled Rejection" block
other than the known-benign `onTaskUpdate` message, to close the residual
gap without depending on a future Vitest API addition.

## Cleanup verified

Coder's evidence claims removal of a stray orphaned fixture
(`bl868-fixture-335-1zvhyy8pk7b.property.test.js`, untracked, left by an
interrupted prior session) before this pass's verification runs. Confirmed
absent: `find extension/test -iname "*fixture-335*"` — no results.
`swarmforge/scripts/operator_path_lib.sh` (untracked, unrelated BL-796
scope) correctly left untouched — present and still untracked, not part
of this diff.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. Forwarding to hardener. Filing a non-blocking rule_proposal
for the residual unhandled-error monitoring gap noted above.

By architect.
