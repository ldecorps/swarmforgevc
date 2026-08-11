# BL-879 architect review — clean pass, NONE

**Ticket:** BL-879 — swarm review-stamp-off of the human-landed
parent-orphaned front-desk fast-reap hotfix (commit `36ea0109e9` on `main`):
a disposable-root `start-bridge-headless.js` / `telegram-front-desk-bot.js`
leftover reparented to launchd (PPID 1) now skips the multi-hour ancillary
age gate and is reaped immediately; babysitter/tmux and every other
ancillary class still require `stale?`.
**Reviewed commit:** `bc52ed4429` (cleaner, forwarded coder's
`git_handoff` unchanged after review).
**Role:** architect.

## Inventory: NONE — every check run or explicitly noted, no defects found.

1. **Dependency-rule gate (BL-259, hard gate).** No file under
   `extension/src` or `extension/media` changed by this parcel or by the
   underlying hotfix (all changes are `.bb`, `specs/pipeline/steps/*.js`,
   `.feature`, and backlog/spec files). Confirmed by running
   `dependency-gate.js` directly against the parcel's changed files — it
   errors "can't open" on every one of them, proving the gate's scope is
   the compiled extension tree. NO-OP, not skipped (same posture as
   BL-812).

2. **Logical coupling (BL-255, co-change-report.js).** Ran against
   `orphan_janitor_lib.bb`, `orphan_janitor_sweep_lib.bb`,
   `process_table_lib.bb`, and the new step-handler file. Suspected
   coupling flagged only among the three janitor-subsystem `.bb` files
   themselves (and their own test runner) — expected, intentional
   cohesion within one module, not a cross-boundary coupling. All other
   co-changers are single-occurrence noise below the reporting threshold.

3. **Invariant 1 — disposable-root required.** Traced the only production
   callsite (`orphan_janitor_sweep_lib.bb`'s `sweep-candidates!`): the
   whole `front-desk?`/`parent-orphaned?` fast-path evaluation sits inside
   the `(tmp-ancillary-cmdline? cmd)` cond branch, which itself requires
   `(extract-disposable-root c)` to match before any front-desk pattern is
   even considered. `reapable-tmp-ancillary?`'s own `cond` checks
   `(not tmp-rooted-ancillary?) false` strictly before the
   `(and front-desk-bridge-or-bot? parent-orphaned?)` fast-path clause, so
   the function's own contract holds even if called with
   `tmp-rooted-ancillary?=false` directly. `front-desk-bridge-or-bot-cmdline?`
   alone does match the host front desk by design (documented in its own
   docstring) but has exactly one caller, and that caller is already gated.
   Confirmed independently (own read of the diff) and via the coder's P0
   exhaustive oracle (32/32) and P1 (300 generated runs, host-rooted
   front-desk cmdline never reaped end to end). **Confirmed.**

4. **Invariant 2 — probe failure/unwired never reads as orphaned.**
   `parent-orphaned?`'s whole body is one outer
   `(catch Exception _ false)` — exception fails closed. Unwired adapter:
   `orphan_janitor_sweep_lib.bb`'s
   `(or (:parent-orphaned?! adapters) (fn [_] false))` defaults to
   constantly-false when the key is absent. Missing-`ProcessHandle` → `true`
   reviewed per the ticket's own flag: a pid that exits between
   enumeration and probe reads as orphaned, but `kill-pid!` on an
   already-gone pid is a no-op and the exposure window is narrower than
   (not wider than) the ordinary `stale?` path's own race tolerance — no
   defect. JDK-25/SecurityManager-removal testability ceiling on the
   `.parent()`/`.isAlive()` exception sub-clause specifically (as opposed
   to the missing-handle branch) is real and correctly documented as a gap
   in what this environment can force, not a gap in the code's own
   behavior (the catch is unconditional and untargeted). **Confirmed.**

5. **Invariant 3 — front-desk-only scope.**
   `front-desk-bridge-or-bot-cmdline?` matches only the two JS
   entrypoints; babysitter/tmux/claude-Babysitter cmdlines never match it,
   so the fast-path clause's `front-desk-bridge-or-bot?` input is `false`
   for them regardless of parent state and the `cond` falls through to the
   ordinary `(not stale?) false` gate. Confirmed via P0 and P2b (generated
   babysitter/tmux cmdlines, disposable-root, freshly parent-orphaned,
   never fast-reaped). **Confirmed.**

6. **Audit-reason precision (review goal 4).** The reason tag fires only
   `(and front-desk? parent-orphaned? (not stale?))` — exactly when the
   fast path was the deciding factor, not when a process happens to be
   both parent-orphaned and independently stale. Matches the ticket's
   stated goal verbatim. **Confirmed.**

7. **Property-test existence/non-vacuity (BL-633/654 gate).** All three
   declared invariants have property coverage in the new
   `bl879_parent_orphaned_front_desk_property_runner.bb` (P0 exhaustive +
   P1/P2a/P2b generated + P3a-d real-JVM scenarios). Re-ran independently
   in this worktree: `ALL PROPERTIES HOLD`. Non-vacuity is documented in
   the file's own header per mutation (cond reorder, regex broadening,
   branch flip, adapter-default flip) with which property caught each —
   not just asserted. No undeclared-property gap on any other touched pure
   module.

8. **Independent re-verification (ran directly, not trusting the evidence
   doc alone):**
   - `process_table_lib_test_runner.bb` — ALL CHECKS PASSED.
   - `orphan_janitor_lib_test_runner.bb` — ALL CHECKS PASSED.
   - `orphan_sweep_enumeration_unavailable_test_runner.bb` — ALL CHECKS
     PASSED.
   - `bl879_parent_orphaned_front_desk_property_runner.bb` — ALL
     PROPERTIES HOLD.
   - `specs/features/BL-879-...-hotfix.feature` via
     `specs/pipeline/scripts/run_acceptance.sh` — 8/8 scenarios pass.

9. **Out-of-scope compliance:** no re-implementation of the janitor, no
   BL-849 Darwin-enumeration rework, no fixture_reaper allowlist changes,
   no interactive Cursor/Telegram session kills — matches the ticket's
   `out_of_scope:`.

## Observation (not a defect, not blocking)

`specs/pipeline/steps/bl879ParentOrphanedFrontDeskSteps.js` hardcodes
`HOST_ROOT = '/Users/ldecorps/projects/swarmforgevc'` for the "no
extractable disposable root" fixture (scenario -04, invariant 1's own
highest-risk scenario), instead of reusing the `REPO_ROOT` constant
already computed in the same file (`path.join(__dirname, '..', '..',
'..')`) — the pattern BL-849's equivalent step file uses for the same
purpose. No functional defect: the scenario only needs a string that fails
`disposable-root-re`, which any host-style absolute path does regardless
of whose machine it names, and it passes identically in this worktree
(where `REPO_ROOT` would actually resolve to the worktree path, not the
hardcoded one). Noted for the record, not bounced — a personal-path
hardcode in a portable-equivalent-already-in-scope fixture is a cleaner-
grade hygiene nit, not an architecture, invariant, or correctness defect.

## Disposition

Architecturally compliant, all three declared invariants hold with
non-vacuous property coverage, acceptance suite green 8/8. Forwarding to
hardender.

By architect.
