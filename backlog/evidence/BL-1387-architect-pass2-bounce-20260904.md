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
