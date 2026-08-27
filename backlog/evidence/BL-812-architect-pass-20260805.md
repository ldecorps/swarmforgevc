# BL-812 architect review — clean pass, NONE

**Ticket:** BL-812 — handoffd's process cwd is not guaranteed to be its argv
project-root; every `target-root`-scoped read in `handoff_lib.bb` shelled
`git rev-parse --git-common-dir` from cwd, so under a foreign cwd the resident
looked absent, chase degraded to waking a session mono-router never creates,
and the swarm starved.
**Reviewed commit:** 268772ba (coder, merged into cleaner as 9017058e, received
via merge_and_process).
**Role:** architect.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** No file under `extension/src`
   or `extension/media` changed in this parcel's diff (only
   `swarmforge/scripts/handoff_lib.bb`, `handoffd.bb`, their test fixtures,
   and specs/backlog files). Confirmed by running `dependency-gate.js`
   directly against the two touched `.bb` files — it errors "can't open" on
   a `.bb` path, proving the gate's scope is the compiled extension tree.
   NO-OP, not skipped.

2. **Co-change / logical coupling (BL-255).** Ran `co-change-report.js`
   against `handoff_lib.bb`/`handoffd.bb`. Top coupling is
   `handoffd.bb` <-> `handoff_lib.bb` itself (12 co-changes) — expected and
   intentional: this parcel's whole fix is the daemon calling into the
   library at startup. No coupling outside this subsystem's existing shape.

3. **Two-layer / IO-ownership / integrate-not-fork rules:** not implicated —
   this parcel touches only the maintained-fork swarm scripts
   (`swarmforge/scripts/*.bb`), not the extension host, webview, or upstream
   SwarmForge source.

4. **Required wiring (both items in the ticket YAML), confirmed present:**
   - `handoff_lib.bb::set-project-root!` — defined (an atom, not a `binding`,
     matching the ticket's own thread-visibility constraint re: handoffd's
     shutdown-hook thread).
   - `handoffd.bb::handoff-lib/set-project-root!` — called once at startup,
     immediately after `project-root` is parsed from argv, before any
     handoff-lib call below it reads `target-root`.

5. **Fix completeness swept beyond the two touched functions:** grepped both
   files for every other cwd-dependent git shell-out. `worktree-root` (line
   35, handoff_lib.bb) also shells git, but it resolves *per-worktree* state
   deliberately distinct from `target-root`'s *shared-project* state (per its
   own docstring) — out of this ticket's declared scope, not a missed site.
   `git-commit-resolves?` (line 885) is called only from
   `ready_for_next_task.bb`/`ready_for_next_batch.bb` — a role's own dequeue
   helper run from that role's own worktree cwd — never from handoffd, so
   the foreign-cwd failure mode doesn't reach it. Every git invocation
   `handoffd.bb` makes directly already passes `{:dir project-root}`
   explicitly (rev-parse HEAD, fetch, push, merge-base, diff-tree, etc.) —
   confirmed by grep, none rely on cwd.

6. **Declared invariants (BL-654), reviewed as three distinct passes:**
   - Invariant 1 (override always wins over cwd): property test
     `bl812_project_root_override_property_runner.bb`, re-ran independently
     in this review — 500/500 generated roots hold, `ALL PROPERTIES HOLD`.
     Non-vacuity already demonstrated twice in the coder's evidence
     (pre-fix tree fails to compile; half-fixed `target-root` fails P1).
   - Invariant 2 (dormant role's actionable mail never produces unbounded
     chase-wake-error) and invariant 3 (wake-session remap is cwd-identical):
     both stated-reason, no separate property test. Accepted: both reduce to
     pre-existing, untouched decision/remap functions
     (`chase-rotate-to!`/`chase-poke-and-notify!`, `resolve-wake-session`)
     that are either inherently impure (real tmux/mailbox) or already proven
     cwd-invariant transitively by invariant 1's property test, and are
     encoded end-to-end instead via acceptance scenarios 03/04. No vacuous
     or missing test — the reasoning is sound and narrowly scoped to what
     this ticket actually changed.

7. **Acceptance** (`specs/features/BL-812-handoffd-cwd-breaks-mono-router-wake-remap.feature`):
   ran `run_acceptance.sh` — 9/9 pass, against the real `handoff_lib.bb` via
   `bl812_root_probe.bb` (never a reimplementation) from a genuinely foreign
   process cwd, with a fake-tmux fixture proving no `send-literal` is ever
   attempted against a nonexistent `swarmforge-architect` session. Scenario
   05 (regression guard: no explicit root set, cwd inside a linked worktree)
   passes, confirming `rotate_to_role.bb`/`operator_runtime.bb`/
   `operator_lib.bb`'s existing git-common-dir fallback is unchanged.

8. **Unit/regression runs**, re-ran independently in this review:
   `handoff_lib_test_runner.bb` (ALL TESTS PASSED),
   `handoff_wake_session_test_runner.bb` (ALL TESTS PASSED),
   `test_rotate_to_role_stuck_parcel_gate.sh` (8/8 PASS). Coder's evidence
   additionally lists `mono_router_lib_test_runner.bb`, `test_chase_sweep.sh`,
   `test_corrupt_handoff_never_dispatched.sh`,
   `test_handoffd_ambulance_wiring.sh`,
   `test_handoffd_pause_suppresses_outbound_wakes.sh`,
   `test_ready_for_next_rotate_home.sh`, `test_sidecar_no_orphan.sh` — all
   green, plus two pre-existing unrelated sandbox-fixture failures
   (`test_operator_runtime_bl647_rotation_liveness.sh`,
   `test_operator_runtime_tick.sh`) confirmed by the coder to reproduce
   identically against the unmodified tree.

9. **Out-of-scope compliance:** host-bridge queue poll/clear/TTL (BL-810/811)
   untouched by this diff; no replacement of mono-router with a full pack;
   BL-638 untouched (already forwarded by this role in a prior rotation).

No property-testable pure module beyond the declared invariants was touched
by this parcel, so no additional (undeclared) property test is owed.

## Disposition

Architecturally compliant. Forwarding to hardender.
