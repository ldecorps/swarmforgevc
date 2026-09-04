# BL-1387 — architect re-review (post bounce-fix), 2026-09-04: BOUNCE (new finding)

Reviewed coder commit `0e31d40b55` (D1 fix, merged in via cleaner `5b8a52914a`).

## D1 verified fixed, plus a self-caught deeper defect

`open-merge-outcome` in `post_hotfix_merge_origin_lib.bb` now routes both
`finish-rematch-recovery`'s bare `(mid-merge?)` check and
`run-post-hotfix-merge!`'s dispatch through classification. Both
production entry points (`post_hotfix_merge_origin.bb`, `swarm_heal.bb`)
now supply `merge-class!`/`index-carries-incoming!`. Re-verified by
re-grepping: `human-merge-in-progress` appears only in the vocabulary file
and the two already-classified call sites.

The coder also found and fixed a more severe, self-discovered defect while
driving the real dispatch end to end: `absorb-dispatch-plan`'s `cond`
propagated only `:skip-human-merge-in-progress`, so `:skip-orphaned-merge`
and `:abort-owned-merge` fell through to `:ff-absorb` — a MUTATING plan on
a checkout with an open `MERGE_HEAD`. Since `handoffd.bb` dispatches
through `absorb-dispatch-plan` (confirmed: `grep -n
absorb-dispatch-plan\|automated-absorb-plan swarmforge/scripts/handoffd.bb`
shows only the former), neither BL-1387's classification nor BL-1386's
abort-by-ownership ever reached the live daemon before this fix — both
acceptance fixtures called the inner `automated-absorb-plan` directly,
the same fixture-vs-production gap as the original D1. Now fixed: the
`cond` names all three open-merge outcomes via a `contains?` set before
falling through. Independently confirmed present and correct by reading
`master_main_reconcile_lib.bb:454-469`.

Independently re-ran rather than trusted:
- `post_hotfix_merge_origin_lib_test_runner.bb` — ALL TESTS PASSED.
- `bl1118_post_hotfix_merge_property_runner.bb` — ALL TESTS PASSED.
- `master_main_reconcile_lib_test_runner.bb` — ALL TESTS PASS.
- `master_main_reconcile_lib_property_runner.bb` — 500 runs, ALL HOLD.
- Dependency gate on the step handler file — PASSED.

## D2 — scenario 06 has no step handler; the acceptance suite is currently RED (new, blames coder)

The specifier's amendment (`00e0ddf694`, merged into this worktree before
this coder pass started — 11:31:47 vs the coder commit's 11:44:22) added
scenario `an-owned-merge-is-the-daemons-not-a-humans-06` to the feature
file. Running the suite now:

```
run_acceptance.sh specs/features/BL-1387-....feature
-> 7 pass, 1 fail
not ok 8 - an ownership record naming the MERGE_HEAD sha classifies the
           merge as the daemon's own
  error: no step handler matched "Then the open merge is classified as
         the daemon's own"
```

Grepped `bl1387OrphanedMergeSurfacedSteps.js` exhaustively (every
`scoped(/^.../)` pattern in the file, listed) — two THEN steps this
scenario needs have no handler anywhere in `specs/pipeline/steps/`:

- `the open merge is classified as the daemon's own`
- `the surfaced reason is neither human-merge-in-progress nor orphaned-merge`

(The scenario's third assertion, `the escalation does not fire early`,
already has a handler shared with scenario 05 and is not part of this gap.)

This is not a spec ambiguity — the specifier's own commit message says
"handler needed" and separately bounces the gap to the coder by note; I am
recording it here too because it currently leaves the parcel's own
acceptance suite red, and a red suite cannot be forwarded regardless of
whose note already flagged it. The underlying production classification
(`classify-open-merge` returning `:own`, `open-merge-branch` routing it to
`:abort-owned-merge`) already exists from the D1 fix — this reads as a
missing test step handler, not missing production logic, but I have not
independently verified that assumption since writing the handler is the
coder's job, not mine to speculate the shape of.

## Verdict

NOT COMPLIANT. D1 confirmed fixed (including the deeper self-caught
defect). D2: the acceptance suite is red — two step handlers for the
specifier's scenario 06 are missing. Bouncing to coder.

## CORRECTION — the revert was wrong, reverted back (self-caught)

`record-bounce.js` returned `verdict: violation` for `0e31d40b55` and I
initially followed its remedy (`git revert --no-edit 0e31d40b55` ->
`b987a1588e`), per BL-490/BL-495. That was a mistake, caught immediately by
testing the live effect rather than trusting the mechanical check:

```
bb -e '(load-file "swarmforge/scripts/master_main_reconcile_lib.bb")
       (println (master-main-reconcile-lib/absorb-dispatch-plan
         {:merge-head-present? true :merge-class :own :behind 3 :ahead 0
          :tip-contains-origin? false :would-conflict? false
          :absorb-would-conflict? false :verdict-unavailable? false}))'
-> :ff-absorb   ;; post-revert: WRONG, a mutating plan on an owned open merge
```

`0e31d40b55`'s `absorb-dispatch-plan` cond fix is what makes BL-1386's
already-approved, forwarded-to-hardener `:abort-owned-merge` branch in
`handoffd.bb` reachable at all — without it, that branch is dead code and
an owned merge falls through to a mutating `:ff-absorb`. D2 (the missing
scenario-06 step handler) is not a defect IN `0e31d40b55` — that commit's
own work (D1 fix + the self-caught `absorb-dispatch-plan` fix) is complete
and correct. The missing handler traces to the SPECIFIER's own later
amendment (`00e0ddf694`), which the specifier's own commit message says it
is charging to itself as a direct note to coder (BL-990) — not something
`0e31d40b55` itself got wrong.

Reverted the revert: `git revert --no-edit b987a1588e` -> `65845bdf40`,
restoring `0e31d40b55`'s content. Confirmed by content: the `bb` probe
above now returns `:abort-owned-merge` again.

**D2 still stands and is still bounced below** — a red acceptance test
cannot be forwarded regardless of which commit is "responsible" for it —
but the bounce commit named to `swarm_handoff.sh` is the tip after
restoring `0e31d40b55`'s content (`65845bdf40`'s descendant), not a
reverted state that would re-break BL-1386.
