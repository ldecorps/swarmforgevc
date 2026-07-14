# INTAKE: The unit suite's 13 seconds is mostly process-spawn tax, not testing

**Raised by:** the human (ldecorps), 2026-07-13 ("13 seconds is far too slow").
**Relayed via:** the Claude Code session of 2026-07-13, which profiled the
suite empirically before filing. Human-raised; the relay is transport.

## Measurement

Full `vitest run` (3337 tests / 235 files) executed and profiled per-file in
an external container ~5.5x slower than the swarm host; ratios and mechanisms
transfer, absolute numbers below are container-time with host-scaled figures
in parens. Vitest 3.2.6, default pool. Twelve tests fail only under root
(permission-denied assertions) — timing unaffected.

Top of the per-file ranking (68% of total test time lives in 20 of 235 files):

| container ms | ~host ms | tests | file |
|---:|---:|---:|---|
| 18079 | ~3300 | 18 | dependencyGateCli.test.js |
| 13333 | ~2400 | 23 | negotiateOnboardingContractCli.test.js |
|  9818 | ~1800 | 21 | paneTailerClass.test.js |
|  7600 | ~1400 | 50 | tmuxClient.test.js |
|  2948 |  ~540 | 55 | bridgeServer.test.js |
|  2520 |  ~460 |  9 | sampleResourcesCli.test.js |

Suite-level overhead reported by Vitest: `collect 18.6s, prepare 23.3s`
(across parallel workers) on top of `tests 114.9s`.

## The four mechanisms, ranked by yield

1. **A fresh `node` per test — 33 test files spawn the CLI-under-test via
   `execFileSync('node', ...)` per test case.** Node startup is ~150–200ms
   host-side before any assertion runs. The hardener rule accepted 2026-07-13
   (99ad07d, "a CLI main() must be called in-process by a test") is the
   countermeasure; this item asks for it to be applied RETROACTIVELY:
   in-process `main()`/`run*()` calls everywhere, exactly ONE spawned smoke
   test per CLI. Worst case compounds it: negotiateOnboardingContractCli
   also runs `git init` + 2x `git config` per test (4 processes/test);
   hoist the git fixture to one beforeAll and copy the directory per test.
2. **dependencyGateCli re-boots the dependency-cruiser engine per test**
   (~1s each, 12 times), six of those proving one rule apiece on
   near-identical fixtures, plus one 3.6s (container) spawn of the compiled
   CLI over the WHOLE real project. Merge the six one-rule fixtures into one
   fixture with six violations asserted from a single engine run; move the
   real-project scan out of the unit suite into the acceptance/gate path
   where a full scan already belongs.
3. **paneTailerClass ignores BL-131's own injection point.** PaneTailer
   takes injectable `scheduleTick`/`clearTick` (paneTailer.ts:231) precisely
   so tests never wait wall-clock — but paneTailerClass.test.js constructs
   every tailer WITHOUT them and awaits real intervals (420–1016ms/test).
   Inject a manual tick; the file drops from ~1.8s host to milliseconds.
   (tmuxClient's deliberate spawn-timeout probes are the same family,
   smaller: consolidate, don't chase.)
4. **Harness config:** with 235 small files, Vitest's default isolated pool
   pays large collect/prepare overhead. Trying `pool: 'threads'` +
   `isolate: false` is a one-line experiment worth 30–50% wall-clock on
   suites this shape — but it is the one change that can BREAK tests
   (cwd/env mutation leaks across files) and must respect the Stryker
   vitest-runner constraint already documented in vitest.config; measure,
   don't assume.

## Expected outcome and why it matters beyond feel

Items 1–3 roughly halve summed test time; realistic post-fix wall clock is
5–7s from today's 13s. The same spawns are re-paid thousands of times per
Stryker mutation run, so every millisecond here multiplies. This intake is
the "why" behind the duration-creep the BL-078/BL-252 machinery
(.test-durations.jsonl, suite-duration trend briefing) can only observe.

## Guardrails for the spec

- Do NOT trade away the "REAL checker/REAL ruleset" property of the
  dependency-gate tests (their stated point) — share the engine run, keep
  the assertions real.
- Keep one genuine end-to-end spawn per CLI as a smoke test; the rule is
  "in-process BY DEFAULT", not "never spawn".
- Any pool/isolation change lands only with two consecutive clean full runs
  and a Stryker run intact.
