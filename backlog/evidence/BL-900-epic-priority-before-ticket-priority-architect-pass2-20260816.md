# BL-900 — architect pass 2 — 2026-08-16

## Scope reviewed

Parcel received from cleaner via `merge_and_process cleaner 19f3057f45`
(fast-forward, `ccaed5dd7c..19f3057f45`). This is BL-900's SECOND pass
through architect: the hardener bounced it once
(`backlog/evidence/BL-900-epic-priority-before-ticket-priority-hardener-bounce-20260816.md`,
D1 — `chase_sweep_lib.bb`'s two `rank-candidates` call sites, named in the
ticket's own scope, were never threaded with an epic-priority index) and the
coder's fix (`19f3057f45`, "thread epic-priority-index through
chase_sweep_lib.bb's rank-candidates call sites") is what is under review
here. Re-derived from the ticket and the code fresh, not from a remembered
prior verdict on the original `324ef75c0` commit.

Files touched by the fix: `swarmforge/scripts/chase_sweep_lib.bb` (gave
`top-open-slot-candidate`/`top-expedited-paused-candidate` the same
2-arity/default-`{}` shape `rank-candidates` itself already has),
`swarmforge/scripts/handoffd.bb` (both call sites now build a real
`epic-priority-index` via `promotion-gates-lib/epic-priority-index
project-root`, mirroring `promotion_gates_cli.bb`'s `cmd-select`),
`swarmforge/scripts/test/dispatch_gap_test_runner.bb` (5 new assertions:
04/05 for `top-open-slot-candidate`, 06/07/08 for
`top-expedited-paused-candidate`, each pairing a "wins only via epic
priority" case with a 1-arity backward-compat case).

Also present in this fast-forward but out of scope: BL-624/BL-897/BL-898
files (`emitCostHealthSidecarCli.test.js`,
`bl897BriefingGathersLifecyclesOnceSteps.js`,
`test_handoffd_lifecycle_snapshot_wiring.sh`) — these rode along from the
hardener's own branch (merge parent `03e311029`, hardener's prior work on
the sibling tickets from the same original batch, already forwarded to
documenter per the bounce evidence's own disposition note). Not this task's
scope, not reviewed here.

## Fix verification

Confirmed `epic-priority-index` (`promotion_gates_lib.bb:305`, `[root] ->
{epic -> min tracker priority}`) is called with the correct arg shape at
both new call sites (`handoffd.bb:1794`, `:1960`, both `project-root`).
`promotion-gates-lib/...` resolves in both `chase_sweep_lib.bb` and
`handoffd.bb` via the pre-existing `load-file` chain
(`handoffd.bb` loads `chase_sweep_lib.bb` loads `promotion_gates_lib.bb`,
line 33) — the same resolution pattern already used by this file's own
pre-existing `rank-candidates` calls, not a new mechanism.

`rank-key` (`promotion_gates_lib.bb:126-130`) is
`[expedited? epic-priority own-priority id]` — epic-priority spliced after
the expedite term exactly as the ticket's "How" section specified, so
invariant 2 holds by construction for every caller of `rank-candidates`,
including these two wrappers.

## Independent test runs (not just re-reading the coder's commit message)

- `bb swarmforge/scripts/test/dispatch_gap_test_runner.bb` — ALL PASS,
  including the 5 new BL-900 assertions.
- `bb swarmforge/scripts/test/promotion_gates_lib_test_runner.bb` — ALL
  PASS.
- `bb swarmforge/scripts/test/promotion_gates_lib_property_runner.bb` — 500
  runs/property, ALL PROPERTIES HOLD, including P9 (expedite bucket stays
  first regardless of epic priority) and P10 (deterministic total order
  under shuffled enumeration) — both exercise `rank-candidates` directly,
  which both wrapper functions now delegate to unconditionally.

## Dependency-rule gate (BL-259, hard gate)

`node extension/out/tools/dependency-gate.js` against the fix's changed
files: not runnable — `chase_sweep_lib.bb`/`handoffd.bb` are `.bb` files,
outside dependency-cruiser's TS/JS graph (confirmed:
`extension/.dependency-cruiser.cjs` scopes to `extension/src/**` and
`extension/media/**` only). N/A this pass, no production TypeScript
changed — same judgment the hardener's own prior evidence recorded for this
same ticket.

## Co-change coupling (BL-255)

`node extension/out/tools/co-change-report.js` against
`chase_sweep_lib.bb`, `handoffd.bb`, `dispatch_gap_test_runner.bb`:
`handoffd.bb` (17 co-changes) and `dispatch_gap_test_runner.bb` (9
co-changes) both flag as "SUSPECTED COUPLING" against `chase_sweep_lib.bb`
— expected and benign: this fix touches exactly the pair the tool already
knows are logically coupled (`chase_sweep_lib.bb` defines the functions,
`handoffd.bb` is their one caller, `dispatch_gap_test_runner.bb` is their
test file), and the commit changes all three together, which is the
coherent slice one fix should produce. No new/unexpected coupling.

## Invariants review (BL-654)

Ticket declares 3 invariants (already carried a property test each from
the ORIGINAL architect pass on `324ef75c0`, unchanged by this fix since the
fix only adds callers of the already-covered `rank-candidates`):

1. *"Ordering only... never grants an extra active slot... never overrides
   orthogonality... the mutation-heavy window... or the circuit breaker."*
   Structural, verified by reading both new call sites end to end: both
   consumers (`open-slot-nudge-sweep!`'s BL-798 escalation nudge,
   `ambulance-auto-exit-sweep!`'s BL-679 release announcement) only use the
   ranked candidate to NAME a ticket in an outbound message — neither touches
   `active_backlog_max_depth`, orthogonality, the mutation-heavy window, or
   the circuit breaker. No promotion decision is made at either site.
2. *"The expedite bucket stays strictly first."*  Covered by P9 (rerun
   above) plus new assertion 07 (`top-expedited-paused-candidate` filters to
   the expedited subset before ranking, so this holds by construction at
   this call site too).
3. *"Deterministic total order... including when an epic priority is
   missing, duplicated across trackers, or unparseable."* Covered by P10
   (rerun above) plus `promotion_gates_lib_test_runner.bb`'s existing
   missing/duplicate-tracker/unparseable-priority assertions — both wrapper
   functions delegate to the exact same `rank-candidates` these properties
   already exercise, no independent re-implementation.

Non-vacuity: re-ran the property/unit suites myself rather than trusting the
commit message; both new example rows (04/06) fail against a hand-reverted
1-arity-only version of the wrappers (confirmed by inspection — omitting the
`epic-index` arg collapses to the pre-BL-900 own-priority-only ranking,
which the fixture's own numbers are chosen specifically to distinguish from
the epic-aware winner).

## Property testing pass

No new/changed pure module outside what the ticket's own Babashka-native
property suite (`promotion_gates_lib_property_runner.bb`, P9/P10) already
covers — the fix is a thin delegation change (thread an existing,
already-tested index through to an already-tested function), not new
ranking logic. `fast-check`/TS property tests N/A, no TypeScript touched.
Not manufacturing a vacuous property test for two-line delegation wrappers
already covered by 5 example-based assertions plus the inherited
Babashka-native properties.

## Correctness spot-check

Traced the two new `handoffd.bb` call sites by hand: both build the
epic-priority-index fresh per sweep call (`project-root` is a constant top-
level binding, `epic-priority-index` does a directory scan — not cached
across calls, matching the ticket's own "built once per ranking call, never
a per-candidate scan" requirement at the RANKING-call granularity; building
it once per SWEEP rather than per candidate is the correct scope). No stale-
index risk, no defect.

## Verdict

Clean. No architecture violation, no invariant violation, no correctness
defect found. D1 (the hardener's bounce) is fully remediated: both named
`chase_sweep_lib.bb` call sites now thread a real epic-priority index.
Forwarding to hardener.

By architect.
