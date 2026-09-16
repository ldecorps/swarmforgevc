# BL-1588 — architect bounce, 2026-09-16

## D1: the "forks" signal is the lane's static pool CEILING, not the actual
concurrency of the current run — invariant 1 is violated in practice, not
just in theory

**Commit reviewed:** 0d7be64b0a (cleaner, task BL-1588-fixture-spawning-property-files-time-out-in-a-full-lane-run)

**Class:** behavior (declared-invariant violation, BL-654's invariant 1)

**The declared invariant (FIRM in `human_approval`):**
> A property test that runs alone on a quiet host (1-minute load at or
> under the quiet ceiling, one fork) receives the same 20 s budget before
> and after this change: the budget grows only with measured concurrency
> or load, never by a bare raise.

**What the code actually does:**
`extension/vitest.properties.config.mjs` sets
`process.env[SWARMFORGE_PROPERTY_LANE_FORKS] = String(WORKER_POOL_SIZE)`
at config-load time, where `WORKER_POOL_SIZE = resolveVitestWorkerPool(...)`
is derived purely from host RAM/cores/pack/rotation
(`resolveFreeCoresCeiling` × `resolveWorkerPoolSize`) — it is the lane's
MAXIMUM pool ceiling, computed identically whether the invocation targets
408 files or 1. `propertyLaneContentionBudget.js`'s `forksFromEnv()` reads
that same static value back inside every worker, with no signal
distinguishing "this file is one of many running concurrently" from "this
file is running alone." `propertyLaneTimeoutMs`'s `forkFactor =
forks/QUIET_LOAD_CEILING` then scales the budget off that ceiling, not off
actual concurrent fork usage.

On this review host right now: 20 cores, ~19.9 GB RAM, 5-min loadavg 7.37 →
`resolveFreeCoresCeiling(20, 7.37) = 12`, `resolveWorkerPoolSize(19904, 12,
640) = 12`. `forkFactor = 12/4 = 3`. A genuinely lone-file run on this host
receives `effectiveBudgetMs(20000, 3) = 60000 ms`, three times the FIRM
"same 20 s budget" the invariant requires — regardless of whether only one
fork is actually doing any work.

**This is not a hypothetical edge case — it reproduces end to end on this
review host right now, via the actual config, with load held out of it
entirely.** Loading the real `vitest.properties.config.mjs` (the exact
module `npm run test:properties` loads, whether it targets 408 files or
one) already sets the real env var, before any test file — let alone
more than one — has even been selected:
```
$ node --input-type=module -e "
  import('./vitest.properties.config.mjs').then(() => {
    console.log('SWARMFORGE_PROPERTY_LANE_FORKS =', process.env.SWARMFORGE_PROPERTY_LANE_FORKS);
  });"
SWARMFORGE_PROPERTY_LANE_FORKS = 11
```
`effectiveBudgetMs(20000, factor)` takes `max(1, factor)` before
multiplying (`contentionBudget.js`), so the result is identical whether
`factor` comes from load or from forks — feeding that real, config-set
value through the real `forksFromEnv()` path with load held at 0 (the
"quiet host" leg of invariant 1) still inflates the base 3x:
```
$ SWARMFORGE_PROPERTY_LANE_FORKS=11 node -e "
  const {propertyLaneTimeoutMs}=require('./extension/test/helpers/propertyLaneContentionBudget');
  console.log(propertyLaneTimeoutMs(20000, {loadavg1mFn: () => 0}))"
55000
```
i.e. a literally-idle-load host, running ONE file alone through the real
config, gets 2.75x the declared 20 s base before that file's own duration
is even measured — because the config sets the "forks" signal to its pool
CEILING at load time, identically regardless of how many files this
invocation actually targets. That is a direct violation of invariant 1's
FIRM text, reproduced without needing to interpret any ambiguous timing
data.

*Corroborating, not conclusive on its own:* `backlog/evidence/BL-1588-coder-post-fix-verification-20260916.md`'s
"20-of-20 alone" table records `bl1315OwnPathsFullRangeInvariants` taking
27.55 s in one "alone" run, above the strict 20000 ms base — consistent
with this defect (their host's ceiling was evidently also above 4), though
by itself that data point cannot rule out ordinary background load on a
shared dev/swarm host as an alternate explanation. The direct reproduction
above does not depend on that ambiguity.

The parcel's own property test
(`bl1588PropertyLaneBudgetConcurrencyInvariant.property.test.js`) does not
catch this: it exercises `propertyLaneTimeoutMs` with `forksFn` injected
directly (`forksFn: () => 1`), never through the real
`vitest.properties.config.mjs` → env-var → `forksFromEnv()` path, so it can
never observe that the real wiring's "forks" value is not 1 for an actual
lone-file run.

**Why this matters beyond the letter of the invariant:** the whole reason
invariant 1 exists (BL-1579's floor rule, carried into this ticket) is to
keep an isolated run's timeout tight enough to still catch real per-test
slowness rather than being auto-relaxed away. Deriving "forks" from the
static pool ceiling defeats that on any host with enough free
RAM/cores — which includes this review host, today, not a hypothetical
future one.

**Remediation (direction, not prescription — same latitude the human
ruling gave the fix):** the "forks" signal needs to reflect how many
fixture-spawning forks are actually concurrent for the CURRENT invocation,
not the lane's configured maximum. Options include: only apply the forks
factor when more than one test file is actually scheduled in this
invocation (a count Vitest's own config/CLI args make available before
config evaluation), or have each worker report/detect its own actual
sibling-worker count rather than reading the static ceiling. Whichever
route is chosen, the new invariant-1 property test must exercise the real
`forksFromEnv()` path (or an equivalent DI seam over the actual "how many
files/forks are running right now" signal), not only the pure function
with a hand-injected `forksFn`.

## Checklist covered this pass
- Dependency-rule gate (`dependency-gate.js`): PASSED, no forbidden edges.
- Co-change report (`co-change-report.js`): nothing at or above the
  default frequency-3 threshold.
- Declared invariants: one declared (BL-654 invariant 1) — property test
  present, non-vacuous against the pure function, but the WIRING it never
  exercises is what violates the invariant (D1 above).
- Correctness read of the three newly-wired test files (bl1308/1315/1354):
  wiring matches bl1343's existing pattern; no site-specific defect beyond
  the shared helper's D1.
- Property-testing pass (undeclared properties): no additional pure
  touched module beyond the one already covered by the declared-invariant
  test; nothing further to add.
- Two-layer boundary / extension-host I/O / webview storage / secrets /
  integrate-not-fork: not applicable — no production TS/webview code
  touched by this parcel.

Single bounce, routed to **coder** (BL-1588 is the coder's own declared
invariant to encode correctly, per coder.prompt's Invariants section).
