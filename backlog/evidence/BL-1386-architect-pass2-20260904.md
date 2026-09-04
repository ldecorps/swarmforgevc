# BL-1386 — architect re-review (post bounce-fix), 2026-09-04

Reviewed coder commit rebuilding after my D1 bounce
(`backlog/evidence/BL-1386-architect-bounce-20260904.md`).

## D1 verified fixed

`grep -n "may-abort-failed-merge?" swarmforge/scripts/handoffd.bb` now
shows a real 2-arity call site (`:abort-owned-merge` branch in
`master-main-reconcile-merge!`), not just the `true`-literal same-tick
call. Read the branch directly: it re-checks ownership via the 2-arity
(failing closed to `human-merge-in-progress` if ownership evaporated
between classification and action — a sound extra safety margin, not
required by the ticket but not wrong either), aborts through the
bounded-retry `master-main-merge-abort!`, clears the record and logs
`aborted-owned-merge` on success, or logs `merge-abort-failed` and returns
failure without a silent fallthrough on a second failed abort.

`open-merge-branch` now maps `:own -> :abort-owned-merge` instead of the
bounced `:skip-human-merge-in-progress`, with a comment block naming this
exact bounce and dated.

The acceptance fixture (`bl1386ReconcileOwnsItsMergeCli.sh`'s
`run-next-tick`) no longer reimplements the decision: it now calls
`classify-open-merge` then `automated-absorb-plan` — the same two
functions the daemon's own dispatch calls — confirmed by reading the
script directly, not just the evidence's claim.

## Independently re-verified (not trusted from evidence alone)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb` —
  ALL TESTS PASS.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  — ALL PROPERTIES HOLD, 500 runs, explicit non-vacuity line for the D1
  fix ("a failed abort neither clears ownership nor falls through - the
  2026-09-04 orphan cannot recur silently") and full 12-cell / 8-cell
  generator-reach confirmations for both BL-1386 and BL-1387's invariants.
- `run_acceptance.sh` on the BL-1386 feature — 7/7.
- `test_handoffd_master_main_reconcile_wiring.sh` — ALL SCENARIOS PASS,
  including the three new BL-1386 D1 assertions: the daemon reaches the
  ownership decision and acts on it; an owned merge routes to the abort
  branch not the human reading; a live human's merge still routes to the
  human reading (BL-1120 intact).

## Cross-ticket conflict, correctly routed

The coder found and reported (not silently resolved) that BL-1387's own
acceptance scenario 02 row 3 (an ownership record as a signal that KEEPS
the human reading) is now stale given this fix, and raised it to the
specifier by priority-00 note rather than papering over it either
direction. The specifier's `00e0ddf694` amendment (merged into this
worktree earlier) confirms and resolves that conflict on the ticket-spec
side; consistent with what I already merged.

## Self-caught regression, worth noting

The coder found that my bounce-revert's clean auto-merge of
`test_handoffd_master_main_reconcile_wiring.sh` had silently dropped the
pre-existing BL-897 cross-boundary constant assertions (no conflict marker,
so git took the revert's older version) — caught only because a later
change referenced now-undefined variables, not by any test failure of its
own. Restored. Worth remembering: a clean auto-merge after a bounce-revert
is not proof nothing was lost.

## Verdict

COMPLIANT. D1 fixed and independently confirmed; forwarding to hardener.
