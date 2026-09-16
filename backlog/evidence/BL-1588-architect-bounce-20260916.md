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

**Evidence this already happened, not just a hypothetical:**
`backlog/evidence/BL-1588-coder-post-fix-verification-20260916.md`'s own
"20-of-20 alone" table records `bl1315OwnPathsFullRangeInvariants` taking
**27.55 s** in an "alone" run. Under the strict unmodified 20000 ms base
that invariant 1 promises for a lone run, that run should have timed out.
It passed only because the wired budget was already inflated past the
declared base on this exact host, in the exact "runs alone" scenario the
invariant is FIRM about. The parcel's own property test
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
