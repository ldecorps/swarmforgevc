# BL-798 architect review — bounce D1 (invariant-unencoded)

**Ticket:** BL-798 — open-slot nudge names its top candidate, escalates
promotion inaction.
**Reviewed commit:** 6c97e2eee (coder, forwarded unmodified by cleaner as
`merge_and_process cleaner 6c97e2eeee`).
**Role:** architect.

## Inventory: 1 defect (D1), routed to coder. Everything else checked clean.

1. **Dependency-rule gate (BL-259, hard gate).** No file under `extension/src`
   or `extension/media` changed — only `swarmforge/scripts/chase_sweep_lib.bb`,
   `handoffd.bb`, and `test/dispatch_gap_test_runner.bb`. Confirmed by running
   `dependency-gate.js` directly against the three touched files — it errors
   "can't open" on `.bb` paths (same as BL-812's precedent), proving the
   gate's scope is the compiled extension tree. NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against the three touched files. Top coupling is
   `chase_sweep_lib.bb` <-> `handoffd.bb` (14 co-changes) and the existing
   chase-sweep test runners — expected: this parcel's whole fix is the
   daemon wiring calling into the library's new pure functions. No coupling
   outside this subsystem's existing shape.

3. **Two-layer / IO-ownership / integrate-not-fork rules:** not implicated —
   swarm-scripts-only change (maintained fork), no extension/webview/upstream
   SwarmForge source touched.

4. **Correctness read.** Hand-traced `decide-open-slot-escalation` and
   `next-open-slot-escalation-state` against all 7 example assertions —
   consistent. Confirmed the wiring in `handoffd.bb`'s
   `open-slot-nudge-sweep!` only advances `open-slot-escalation-state` when
   `decide-open-slot-nudge?` already gates on cooldown, and confirmed
   `-main`'s loop is a single-threaded `(loop ... (recur ...))` — the
   deref-then-`reset!` pattern on the atom (vs `swap!`, used by the sibling
   `loop-detect-states`/`auth-observe-states` atoms two lines above) carries
   no actual race risk given the confirmed single-threaded sweep cadence, so
   not a defect, just a minor style deviation not worth a bounce.
   `nudge-coordinator-open-slot!`'s arity change (0-arg -> required 1-arg) has
   exactly one production call site, already updated; no stale caller found
   by grep.

5. **Declared invariants (BL-654), reviewed as three distinct passes:**
   - **Invariant 1** (nudge names the Article-3.2.4-ranked top candidate):
     `top-open-slot-candidate` is a thin wrapper over
     `promotion-gates-lib/rank-candidates`, already property-tested broadly
     by `promotion_gates_lib_property_runner.bb`'s P4 ("an expedited
     candidate always beats every non-expedited one regardless of priority
     number; priority then id is the only tie-break") across generated
     candidate sets. Ranking correctness is covered transitively; the new
     wiring/extraction logic (`:id`/`:approved?`) is covered by 4 direct
     example assertions plus a real-file-backed read-paused-candidates
     round-trip. Adequate — mirrors BL-812's own accepted "already proven
     transitively" pattern for a reused, already-property-tested function.
   - **Invariant 2** (repeated unacted nudges escalate past a bounded count,
     never repeat silently) — **D1, see below.**
   - **Invariant 3** (coordinator never clears without promoting or
     recording a blocking reason): the coder's commit message states this
     "quantifies over prose or process rather than a pure, testable module"
     (citing the coder role's own carve-out, precedent
     `promotion_gates_lib_property_runner.bb` P5/P6/BL-853) — a legitimate
     non-encodability reason, consistent with established project
     precedent. Accepted, no property test required. **However**, the
     underlying deliverable (a `swarmforge/roles/coordinator.prompt`
     amendment, per this ticket's own description: "lands as a prompt
     amendment in the same parcel; the specifier owns that file") has not
     actually landed — `grep` for the never-clear-without-cause duty in
     `coordinator.prompt` finds nothing, and the file's last commit
     (4c3c273c4, 2026-08-08) predates this ticket's activation. This is a
     **spec-gap** (required_stages for this ticket has no `specifier` entry,
     so this ticket's own pipeline structurally cannot deliver invariant 3's
     prose amendment) — routed by `note` to specifier+coordinator per
     Article 4.4, not blocking this bounce or the parcel.

## D1 — invariant-unencoded: invariant 2 has no property coverage, no stated reason

`decide-open-slot-escalation` / `next-open-slot-escalation-state`
(`swarmforge/scripts/chase_sweep_lib.bb`) are a brand-new pure state machine
threading `{:candidate-id :count :escalated}` across sweep ticks — the exact
same shape as `provider_auth_observe_lib.bb`'s episode-state machine, which
the coder's own commit message says this "mirrors ... exactly". That
precedent has a dedicated property runner
(`provider_auth_observe_lib_property_runner.bb`) proving, over GENERATED
arbitrary-length episode sequences: P1 "respawns per episode never exceed the
configured cap, across ALL episodes in the sequence" and P2 "exactly one
:alert action per episode whose length exceeds the cap (never zero, never
more than one)", each independently demonstrated non-vacuous against a
deliberately broken implementation.

BL-798's `decide-open-slot-escalation` makes the analogous promise for
invariant 2 ("never repeat silently... past a bounded count... escalates")
but ships only 7 hand-picked example assertions in
`dispatch_gap_test_runner.bb` (fixed threshold=3, single-step transitions
from hand-built prior states) — no generative test over arbitrary thresholds
or arbitrary-length tick sequences for a fixed candidate, and no stated
non-encodability reason (unlike invariant 3, which got one explicitly).

I confirmed the example tests are non-vacuous at the single-step level (a
deliberate break of the `(not (:escalated state))` guard — making it
re-escalate every tick once at/above threshold — was caught by
`open-slot-escalation-04`, restored after). That proves the individual
branches are exercised, but not the SEQUENCE-shaped guarantee the invariant
actually states: for an arbitrary threshold and an arbitrary-length run of
ticks against a fixed candidate, `:escalate` fires **at most once**, and
after it fires the action is `:none` **forever** until the candidate
changes. That is exactly the shape of property P1/P2 prove for the mirrored
precedent, and it is missing here.

**Remediation:** either (a) add a property runner
(`bl798_open_slot_escalation_property_runner.bb`, following the
`provider_auth_observe_lib_property_runner.bb` P1/P2 shape: generate
arbitrary thresholds and arbitrary-length tick sequences for one or more
candidates, assert escalate count per candidate-episode is exactly 0 or 1,
never more, and that count never drives more than one `:escalate`), or (b) if
the coder judges the 7-branch cond exhaustive enough to not warrant one,
state that reasoning explicitly in the commit message the way invariant 3's
carve-out was stated — per this role's own instruction, a missing property
test with no stated reason is the defect, not a judgment call the architect
makes on the coder's behalf.

**Class:** invariant-unencoded. **Blamed role:** coder (author of the
declared invariant's property test, per architect.prompt's Invariants
Review).
