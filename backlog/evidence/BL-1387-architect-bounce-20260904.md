# BL-1387 — architect review, 2026-09-04: BOUNCE

Reviewed coder commit `a51b4d68fe` (merged in via cleaner `b2c3cf0a36`).

## Checks that passed

- Dependency gate on `specs/pipeline/steps/bl1387OrphanedMergeSurfacedSteps.js`:
  PASSED, no forbidden edges.
- `required_wiring` anchors: `orphaned-merge` present in both
  `handoffd.bb` and `master_main_reconcile_lib.bb`; step handler registers
  (`check_feature_handler_registration.sh` rc 0).
- Invariant 2 (aborts nothing): satisfied — no git-write adapter was added
  or changed by this commit's own diff; `master-main-open-merge-class` and
  its siblings are read-only.
- Invariant 3 (index-carries-incoming, never from unmerged count): the
  code reads correctly — `index-carries-incoming?` intersects
  `git diff --cached --name-only HEAD` with `git diff --name-only HEAD
  MERGE_HEAD`, returns `nil` (not `false`) when either side is unreadable,
  and is never derived from unmerged-path count anywhere in the diff.
- `open-merge-branch`'s backward-compat degrade (absent `merge-class` ->
  today's behavior) is correct and does not regress any existing caller
  that still doesn't pass it (see D1 below for why that degrade path
  matters).
- `master_main_reconcile_lib_test_runner.bb`, `_property_runner.bb` (500
  runs), BL-1386's own re-run (7/7), `test_handoffd_master_main_reconcile_
  wiring.sh`, and the BL-1387 acceptance feature (8/8) all green — re-ran,
  not trusted. The acceptance fixture drives the REAL lib functions
  (`classify-open-merge`, `automated-absorb-plan`, `surface-message`,
  `orphaned-merge-escalation`) against a real repo, not a reimplementation
  — unlike BL-1386's fixture, this one is not vacuous.

## D1 — invariant 1 is violated at a second, un-updated call site (correctness, blames coder)

**Invariant 1: "human-merge-in-progress is never asserted from MERGE_HEAD
presence alone... requires positive evidence of an owner."** This commit's
own docstring for `open-merge-branch` says it is "the ONE mapping... shared
by every plan that used to test `merge-head-present?` directly, so the
three cannot drift apart" — but there is a fourth, unwired:

```
grep -rln "absorb-dispatch-plan\|post-land-absorb-plan\|automated-absorb-plan" \
  swarmforge/scripts/*.bb
# master_main_reconcile_lib.bb, post_hotfix_merge_origin_lib.bb, handoffd.bb
```

`post_hotfix_merge_origin_lib.bb`'s `run-post-hotfix-merge!` calls
`absorb-dispatch-plan` with `:merge-head-present? (boolean (mid-merge?))`
and **no `:merge-class`**, so it falls straight into `open-merge-branch`'s
backward-compat branch — `(and (nil? merge-class) merge-head-present?)
:skip-human-merge-in-progress` — asserting a human owns any open merge
from presence alone, exactly the reading this ticket exists to retire.
`finish-rematch-recovery` in the same file makes the same assertion a
second way, entirely outside `absorb-dispatch-plan`:

```clojure
(cond
  (mid-merge?)
  {:ok? false :exit 1 :outcome :human-merge-in-progress :mid-merge? true}
  ...)
```

This file's own docstring on `absorb-dispatch-plan` (unchanged by this
commit) calls it "Single absorb decision for handoffd **+ post_hotfix
runners**" — the sharing this ticket's fix depends on for coverage is the
file's own stated contract, and half of it was left at the old reading.

**Why this matters more here, not less:** `post_hotfix_merge_origin.bb`
and `swarm_heal.bb` (both live production entry points into this lib,
confirmed by `grep -rln run-post-hotfix-merge! swarmforge/scripts/*.bb`)
are exactly the tools an operator reaches for when the checkout looks
stuck — `swarm_heal.bb`'s own header calls it "Operator one-shot: unblock
coordinator bookkeeping when main-sync is stuck." An operator running
either against the daemon's own orphaned leftover (BL-1386's failure mode)
still gets the unhelpful `human-merge-in-progress` this ticket was minted
to stop misdirecting people with, in the very tool most likely to be run
by the person trying to diagnose exactly that state.

Not covered by `required_wiring` (both anchors name `handoffd.bb` /
`master_main_reconcile_lib.bb` generically, not this specific second
site), and not exempted by the ticket's "Explicitly NOT in scope" list
(aborting, preventing the orphan, the tick-threshold) — none of which
mentions `post_hotfix_merge_origin_lib.bb`. Invariant 1 itself is stated
unconditionally, with no carve-out for this file.

**Fix, not mine to write:** either thread `merge-class` through
`run-post-hotfix-merge!`'s callers (both scripts already shell out per
tick/run and could add the same `pgrep -x git` / lock-mtime / index-diff
adapters `handoffd.bb` now has), or, if that liveness read is judged out
of scope for a one-shot operator tool, at minimum classify against
BL-1386's ownership record and the index-carries check (both cheap, no
process table needed) so an orphaned-with-poisoned-index state is not
silently read as "someone's mid-merge, do nothing" there either — and
update `finish-rematch-recovery`'s bare `(mid-merge?)` check the same way.

## Co-change

`co-change-report.js` on `handoffd.bb`/`master_main_reconcile_lib.bb`
returns the expected hub coupling for two files touched by nearly every
ticket in this area; no new smell beyond D1 above (which static co-change
data cannot surface — found by reading the shared function's own callers).

## Verdict

NOT COMPLIANT. Correctness defect (D1) — a second live call site of the
shared decision function still asserts `human-merge-in-progress` from bare
`MERGE_HEAD` presence, contrary to the ticket's own unconditional
invariant 1. Bouncing to coder.

## Revert (BL-490/BL-495)

`record-bounce.js`'s revert check returned `verdict: violation` naming
`a51b4d68fe` (the bounced defect commit itself). Reverted on
`swarmforge-architect`: `git revert --no-edit a51b4d68fe` -> `793dbfaf02`.
Confirmed by content, not ancestry: `classify-open-merge` and the new step
handler are both absent post-revert. Note for whoever picks this up next:
this branch's `master_main_reconcile_lib.bb`/`handoffd.bb` still carry
BL-1386's write-side (`owns-merge-head?`, `:record-owner!`/`:clear-owner!`)
from an earlier cross-branch merge, unaffected by this revert — that is
expected and correct (this revert only undoes `a51b4d68fe`'s own diff), not
a sign BL-1386 is done: `master-main-reconcile-merge!` still does not pass
`merge-class` to `absorb-dispatch-plan` (BL-1387's own contribution, now
reverted), so BL-1386's next-tick abort-by-ownership gap (BL-1386-architect-
bounce-20260904.md) is unaffected either way.
