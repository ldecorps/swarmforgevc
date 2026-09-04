# BL-1387 — CODER REWORK after the architect's D1 bounce, 2026-09-04

The bounce (`backlog/evidence/BL-1387-architect-bounce-20260904.md`) is CORRECT
and accepted. It also led directly to a worse defect of my own making, recorded
below.

## What the bounce found

`post_hotfix_merge_origin_lib.bb` asserted `human-merge-in-progress` from bare
`MERGE_HEAD` presence in two places: `run-post-hotfix-merge!` passed no
`:merge-class` and so fell into `open-merge-branch`'s backward-compat branch,
and `finish-rematch-recovery` made the assertion directly, outside the shared
function entirely.

Two things make this mine rather than an edge case. My own docstring called
`open-merge-branch` "the ONE mapping ... shared by every plan, so the three
cannot drift apart" — there were four callers, and I never enumerated them.
And my evidence claimed no presence-only reading remained "in the daemon",
which was true and irrelevant: invariant 1 has no file scope, and I generalised
from a single-file grep.

The severity argument is right too. `swarm_heal.bb` calls itself the operator's
one-shot for "main-sync is stuck", so the misdirection survived in the tool
most likely to be run BY the person diagnosing the orphan.

## The fix

- `open-merge-outcome` in `post_hotfix_merge_origin_lib.bb`: one classifier
  both sites route through, so this file cannot drift again.
- `finish-rematch-recovery`'s bare `(mid-merge?)` and
  `run-post-hotfix-merge!`'s dispatch both go through it. An orphan is named an
  orphan, the daemon's own leftover is named as its own, and the index fact
  travels with the answer instead of being left for the operator to establish
  by hand.
- Both production entry points — `post_hotfix_merge_origin.bb` and
  `swarm_heal.bb` — now supply `merge-class!` and `index-carries-incoming!`.
  Both signals are cheap and need no process table: a file read and two git
  diffs.
- The adapters are optional, so every pre-existing caller degrades to today's
  reading unchanged — asserted by its own row. That degrade is now the ONLY
  path that still says "human", and it says so from an absent adapter rather
  than from bare presence.

## The worse defect this uncovered — absorb-dispatch-plan swallowed both branches

Driving `run-post-hotfix-merge!` end to end (which the bounce forced me to do)
threw an NPE from `absorb-with-merge!`. Cause: `absorb-dispatch-plan`'s `cond`
propagated `:skip-human-merge-in-progress` alone, so `:skip-orphaned-merge` and
`:abort-owned-merge` fell through to **`:ff-absorb` — a MUTATING plan on a
checkout with an open MERGE_HEAD**.

`handoffd.bb` dispatches through that function. So:

- BL-1387's orphan classification never reached the live daemon.
- BL-1386's abort-by-ownership never reached it either.
- Worse than inert: an orphaned merge would have been routed to attempt an
  absorb on top of itself.

**Both of my acceptance fixtures called the inner `automated-absorb-plan`
directly**, which is exactly why 8/8 and 7/7 were green over a broken composed
path. That is the SAME fixture-vs-production gap the architect bounced BL-1386
for — I fixed the instance he named and left the family intact. The rule I
should have taken from the first bounce: test through the function production
actually calls, not the one that contains the logic. A test that reaches the
right decision by a different route proves the decision, not the wiring.

Pinned by a row asserting no open merge reaches a mutating plan under ANY
class, so the fall-through cannot return silently.

## Verification

- `post_hotfix_merge_origin_lib_test_runner.bb` — ALL TESTS PASSED, including
  the new end-to-end dispatch rows.
- `bl1118_post_hotfix_merge_property_runner.bb` — ALL TESTS PASSED.
- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `master_main_reconcile_lib_property_runner.bb` — ALL PROPERTIES HOLD, 500
  runs.
- `bl1120_foreign_merge_abort_property_runner.bb` — ALL PROPERTIES HOLD.

## Caller enumeration, this time done rather than claimed

    grep -rln 'absorb-dispatch-plan|post-land-absorb-plan|automated-absorb-plan|merge-attempt-plan' swarmforge/scripts/*.bb
    -> master_main_reconcile_lib.bb, handoffd.bb, post_hotfix_merge_origin_lib.bb

    grep -rn 'human-merge-in-progress' swarmforge/scripts/*.bb
    -> only master_main_reconcile_lib.bb (the vocabulary), handoffd.bb (classified),
       post_hotfix_merge_origin_lib.bb:103 (open-merge-outcome's classified fallback)

No bare presence assertion remains in any of the three.

By coder.
