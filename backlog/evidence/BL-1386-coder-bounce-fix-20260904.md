# BL-1386 — CODER REWORK after the architect's D1 bounce, 2026-09-04

The bounce (`backlog/evidence/BL-1386-architect-bounce-20260904.md`) is
CORRECT on both counts and is accepted without argument. Recording what it
found, because the shape is worth keeping:

## D1a — the headline deliverable was never wired to the live daemon

The ticket's own title says "...the daemon records which MERGE_HEAD is its own
**and aborts it next tick**". I built `owns-merge-head?` and the 2-arity
`may-abort-failed-merge?`, unit- and property-tested them — and then wired the
daemon's `:abort!` adapter as `(may-abort-failed-merge? true)`, a literal. The
ownership arity was unreachable from production. On the tick after a failed
abort — the exact scenario the ticket exists for — the live daemon still
called its own leftover a human's.

The architect's evidence was a grep returning nothing. That same grep now
returns three call sites.

## D1b — my acceptance concealed it by re-implementing the missing logic

`run-next-tick` computed `owned?` itself, then called `git merge --abort` and
`clear-merge-owner!` itself. Scenario 03 passed while proving only that the
lib's predicate computes a boolean; it said nothing about whether the daemon
ever reaches that decision. I then cited it in evidence as verification of the
very thing it could not verify.

## The fix

- `open-merge-branch` routes `:own` to a new `:abort-owned-merge` branch
  instead of `:skip-human-merge-in-progress`. The old mapping encoded the
  assumption the bounce overturned — that "BL-1386 finishes it elsewhere",
  when there was no elsewhere.
- `handoffd.bb` acts on that branch: it re-checks ownership through the
  2-arity (failing CLOSED to today's reading if ownership evaporated between
  classification and action), aborts through the bounded-retry helper, clears
  the record, and logs. This is the only production caller of the ownership
  arity, which is the point.
- The fixture no longer decides anything. `run-next-tick` calls
  `classify-open-merge` then `automated-absorb-plan` — the same two functions
  the daemon's dispatch calls — and performs only what the daemon's adapters
  perform, only when production says to.

**Proved non-vacuous by construction**: with the pre-bounce mapping restored,
the rebuilt scenario reports `:skip-human-merge-in-progress` and fails. The
handler now pins `tick2-branch` to `:abort-owned-merge`, so a regression that
re-routes `:own` fails there rather than passing quietly.

**Consumer-side pins added** (`test_handoffd_master_main_reconcile_wiring.sh`),
which is the second half of what the architect asked for: the daemon must call
`may-abort-failed-merge?`, pass an `:owner-record`, ask `owns-merge-head?`, and
carry an `:abort-owned-merge` branch — plus assertions that an owned merge
routes to the abort and a live human's still routes to the human reading, so
BL-1120 cannot regress silently.

## Two assertions of my own that the fix correctly broke

Both were written under the assumption the bounce overturned, and both are
corrected rather than relaxed:

1. A unit row expected `:own` → `:skip-human-merge-in-progress`.
2. BL-1387's property invariant 2 demanded that EVERY class yield a
   non-mutating branch. That encoding would have failed BL-1386's fix as
   though it were a regression, and passed the bounced code as though it were
   correct. It is now per-class and STRONGER: a merge the daemon cannot prove
   is its own is never aborted, and `:own` is the only class that may act —
   which is BL-1386's invariant 2 read from the other side.

## CROSS-TICKET CONFLICT raised, not papered over

BL-1387's feature (already forwarded to the cleaner) lists "an ownership record
naming the MERGE_HEAD sha" as an owner signal that keeps the
`human-merge-in-progress` reading. After this fix an owned merge is ABORTED,
not surfaced as a human's, so that Examples row is stale. Scenario 02 row 3
now FAILS on this branch, deliberately:

- BL-1387's fixture had been deriving its reason with an else-branch that
  absorbed the new `:abort-owned-merge` and reported the old reading. That is
  the same masking shape as D1b, so it is removed; the reason is now a total
  `case` over the branch production returns.
- Raised to the specifier by priority-00 note. Not resolved here: making the
  handler accept either answer is the passthrough the constitution forbids,
  and reverting the routing is the bounced defect.

## Verification

- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `master_main_reconcile_lib_property_runner.bb` — ALL PROPERTIES HOLD, 500
  runs, both tickets' invariants, generator reach asserted for both cubes.
- BL-1386 acceptance — 7/7.
- BL-1387 acceptance — 7/8, the one failure being the spec conflict above.
- `test_handoffd_master_main_reconcile_wiring.sh` — ALL SCENARIOS PASS, all
  six BL-1386 assertions green.

## A second casualty of the bounce revert, found by a broken test

The revert of `7836b7364a` touched EIGHT files. Four conflicted and were
resolved by hand. `test_handoffd_master_main_reconcile_wiring.sh` did NOT
conflict — it auto-merged clean, so git silently took the revert's version and
removed the BL-897 cross-boundary constant assertions along with the `LIB_BB`
/ `DAEMON_BB` definitions. It surfaced only as `DAEMON_BB: unbound variable`,
and only because the new D1 block happened to reference those variables. A
self-contained D1 block would have left the constant-agreement pin silently
deleted with no symptom at all — un-testing the very check that stops the
daemon writing one file while BL-1387 reads another.

Restored, and all eight reverted paths audited rather than only the four git
flagged. The rule this earns: after a bounce-revert merge, diff against the
reverted commit for EVERY path it touched. The clean merges are the dangerous
ones, because they do not ask.

By coder.
