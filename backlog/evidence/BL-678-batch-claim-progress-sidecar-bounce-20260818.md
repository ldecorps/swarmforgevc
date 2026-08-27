# BL-678 architect bounce — 20260818

**Commit reviewed:** a140fcc393 (BL-678: batch claims write a progress
sidecar, chase-side observers consult it — by coder, forwarded unchanged by
cleaner)

## Review inventory (Article 4.4 — complete pass, one bounce)

- **Dependency-gate hard gate (BL-259):** N/A this parcel — no `extension/src`
  or `extension/media` files changed (all changes are in `swarmforge/scripts/`,
  `specs/pipeline/steps/`, `specs/features/`, `backlog/`). Confirmed by running
  `node extension/out/tools/dependency-gate.js` against the changed files,
  which correctly errors that the paths aren't part of the extension's own
  scan scope — no forbidden edge to report.
- **Co-change coupling (BL-255):** ran `co-change-report.js` over the changed
  files. `chase_sweep_lib.bb` <-> `handoffd.bb` shows 18 co-changes
  (SUSPECTED COUPLING) — this is pre-existing, long-standing coupling in the
  chase-sweep subsystem (both files predate this ticket and are routinely
  touched together for every chase-sweep feature); not new coupling
  introduced by this parcel. No action needed.
- **Invariants (BL-633/BL-654):** ticket declares 2 invariants. Both have
  dedicated, non-vacuous property tests in
  `swarmforge/scripts/test/bl678_batch_claim_progress_invariants_property_runner.bb`
  (P1 sidecar-exists-claim-to-completion, P2 fresh-progress-never-surfaces),
  each with a broken-implementation counter-check proving the test actually
  bites. Ran green. Reviewed both invariants against the full parcel (not
  just the diff's highlighted sites) — both hold everywhere: the sidecar is
  written the instant `ready_for_next_batch.bb` claims a parcel (never
  lazily), and `decide-batch-claim-observation` is the only path capable of
  surfacing a suspect, structurally incapable of re-forwarding/re-delivering.
  **No violation.**
- **Property coverage (undeclared):** touched pure modules are already
  covered by the invariant properties above plus
  `batch_claim_progress_lib_test_runner.bb`'s example-based unit tests. No
  additional property coverage needed.
- **Acceptance (BL-761/BL-880 contract):** `acceptance:` field in the ticket
  YAML is a proper single-line pointer (not a block scalar — the BL-624/
  BL-625 class of defect). Ran the full feature end-to-end via
  `node specs/pipeline/cli.js specs/features/BL-678-batch-claim-progress-sidecar.feature`
  — all 5 scenarios pass, driving the real production scripts
  (`ready_for_next_batch.bb`, `batch_claim_progress_cli.bb`,
  `batch_claim_progress_sweep_harness.bb`), not a re-derived approximation.
- **Correctness read:** see D1 below.

## D1 — dead code with a self-contradicting design-rationale comment

**Class:** behavior (dead-code/DRY hygiene — cleaner's domain, Article 1.4)
**Blamed role:** cleaner (owns readability/DRYness/maintainability; the
function was coder-authored but this is exactly the class of defect
cleaner's pass exists to catch, and the parcel was forwarded unchanged)

`swarmforge/scripts/batch_claim_progress_lib.bb:97-103` defines
`within-cooldown?`, documented as:

> "Mirrors chase_sweep_lib.bb's within-dropped-parcel-cooldown? shape
> exactly - deliberately duplicated (this codebase's own established
> 'small live-glue duplicated across independent pure libs' posture)
> rather than cross-coupling this lib to chase_sweep_lib.bb."

This function is never called by any production code path. Verified by
grep across `swarmforge/scripts/`: the only call site is its own dedicated
unit test in `batch_claim_progress_lib_test_runner.bb` (3 assertions). Every
actual caller — `handoffd.bb`'s `batch-claim-progress-sweep!` (the
production sweep) and `batch_claim_progress_sweep_harness.bb` (the
acceptance-test harness that exercises the real mechanism) — calls
`chase-sweep-lib/within-dropped-parcel-cooldown?` instead, the pre-existing
function the new one claims to "mirror ... rather than" couple to.

Two problems with this, both concrete:

1. **The stated rationale is factually backwards.** `chase_sweep_lib.bb`
   already `load-file`s `batch_claim_progress_lib.bb` (see
   `chase_sweep_lib.bb:29-32`, added in this same commit) — so
   `chase_sweep_lib.bb` calling `batch-claim-progress-lib/within-cooldown?`
   would introduce **zero** new coupling; the dependency already exists in
   that direction. There was never a coupling cost to avoid.
2. **The comment actively misleads future maintainers.** It frames this
   duplication as "this codebase's own established ... posture" — i.e. an
   intentional convention to follow. A future ticket touching this area will
   read that comment and duplicate another cooldown predicate on the same
   false premise, when the actual, observable convention (every real call
   site) is to reuse `chase_sweep_lib.bb`'s single implementation.

**Remediation:** delete `batch_claim_progress_lib.bb`'s `within-cooldown?`
function and its 3 dedicated unit tests in
`batch_claim_progress_lib_test_runner.bb` (dead code, superseded by the
already-in-use `chase-sweep-lib/within-dropped-parcel-cooldown?`). If a
local, decoupled predicate is genuinely wanted instead, wire it to the
actual call sites (`handoffd.bb`'s `batch-claim-progress-sweep!` and
`batch_claim_progress_sweep_harness.bb`) and fix the comment's rationale —
but deletion is the simpler, more consistent fix given every real call site
already agrees on the shared implementation.

No other findings survived this pass — the remainder of the parcel
(architecture boundaries, both declared invariants, property coverage,
acceptance e2e) is clean.
