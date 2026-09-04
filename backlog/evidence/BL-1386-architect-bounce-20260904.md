# BL-1386 — architect review, 2026-09-04: BOUNCE

Reviewed coder commit `7836b7364a` (merged in via cleaner `7c587146e3`).

## Checks that passed

- Dependency gate on `specs/pipeline/steps/bl1386ReconcileOwnsItsMergeSteps.js`:
  PASSED, no forbidden edges.
- Co-change on `handoffd.bb`/`master_main_reconcile_lib.bb`: all hits are
  the expected hub coupling of a large daemon file touched by nearly every
  ticket; no new smell.
- Invariant 2 (never abort a foreign merge): satisfied — `handoffd.bb`'s
  `:abort!` adapter only ever calls `may-abort-failed-merge?` with the
  literal `true` (this-tick), so the ownership-based 2-arity path is never
  exercised in production at all (see the defect below — this is a symptom
  of the same gap, not independent safety).
- Invariant 3 (failed abort never reported as success, git's own text):
  satisfied — `handoffd.bb`'s `:log!` and `absorb-with-merge!`'s ladder
  correctly log `merge-abort-failed` with git's real error text and never
  fall through to `fallback!` on a failed abort.
- `master_main_reconcile_lib_test_runner.bb`,
  `_property_runner.bb` (500 runs), `test_handoffd_master_main_reconcile_wiring.sh`,
  and the BL-1386 acceptance feature (7/7) all green — re-ran, not trusted.

## D1 — the ticket's headline deliverable is not wired into the live daemon (correctness, blames coder)

**The ticket's own title is "...the daemon records which MERGE_HEAD is its
own and aborts it next tick" — that half is not implemented.**

`master_main_reconcile_lib.bb` gained `owns-merge-head?` and a 2-arity
`may-abort-failed-merge?` that would let a LATER tick prove ownership of a
leftover `MERGE_HEAD` and abort it instead of surfacing
`human-merge-in-progress`. Both are unit- and property-tested in
isolation. But **`handoffd.bb` never calls either one**:

```
grep -n "owns-merge-head?\|may-abort-failed-merge? false\|owner-record" \
  swarmforge/scripts/handoffd.bb
# (no matches)
```

The daemon's actual dispatch — `master-main-reconcile-merge!` ->
`absorb-dispatch-plan` -> `automated-absorb-plan`/`post-land-absorb-plan`/
`merge-attempt-plan` — keys on `merge-head-present?` (a bare boolean) alone,
exactly as before this ticket. Every one of those still routes ANY
pre-existing `MERGE_HEAD` straight to `:skip-human-merge-in-progress`
regardless of who owns it. So on the tick immediately after a failed
abort — the exact scenario this ticket exists to fix — the live daemon
still calls its own leftover merge a human's and refuses to touch it. The
2026-09-04 incident this ticket was minted from is unfixed for that half.

**The acceptance test does not catch this because it does not drive the
real dispatch.** `specs/pipeline/steps/lib/bl1386ReconcileOwnsItsMergeCli.sh`'s
`run-next-tick` function, backing scenario `the-next-tick-aborts-by-
ownership-03`, HAND-REIMPLEMENTS the intended behavior directly in the
fixture script — it computes `owned?` itself, then calls `git merge --abort`
and `clear-merge-owner!` itself, entirely inside the test file:

```clojure
(if owned?
  (let [{:keys [exit err]} (git "merge" "--abort")]
    (if (zero? exit)
      (do (master-main-reconcile-lib/clear-merge-owner! daemon-dir)
          (swap! logs conj ["aborted-by-ownership" ""])
          {:outcome "aborted-by-ownership"})
      ...
  (do (swap! logs conj ["skip-human-merge-in-progress" ""])
      {:outcome "skip-human-merge-in-progress"}))
```

This proves the LIB's `owns-merge-head?`/`may-abort-failed-merge?` compute
the right boolean in isolation. It proves nothing about whether
`handoffd.bb` ever reaches that decision on a real tick — and it does not,
per the grep above. `qa_e2e_procedure` step 3 ("the daemon aborts by
ownership... no human-merge-in-progress was ever surfaced for it") is
consequently unverified against the real daemon, only against a
reimplementation of the daemon inside the test.

**Fix, not mine to write:** wire `master-main-reconcile-merge!`'s dispatch
(and any sibling caller of `automated-absorb-plan`/`post-land-absorb-plan`/
`merge-attempt-plan` that currently treats `merge-head-present?` as
disqualifying) to read the ownership record and the current `MERGE_HEAD`
sha, and route to an abort-by-ownership branch instead of
`:skip-human-merge-in-progress` when `owns-merge-head?` is true — then
either extend the acceptance fixture to drive that real dispatch function
(not reimplement it), or accept the existing scenario only proves the
lib's predicate and add a wiring-level assertion that a real `handoffd.bb`
tick reaches it (BL-1235 consumer-anchor style, matching how this ticket's
own `required_wiring` treats the log line and the file name).

## Verdict

NOT COMPLIANT. Correctness defect (D1) — the ticket's core promised
behavior is unwired from the live daemon and the acceptance suite that
should have caught it instead re-implements the missing logic in the
fixture. Bouncing to coder.
