# BL-1214 — architect bounce (1st), 2026-08-28

Commit reviewed: 6b08f29d2 (coder), merged into architect worktree via
cleaner tip 893ebbc6a5.

## Architecture / dependency-gate / co-change
Clean. No TypeScript extension source touched (dependency-gate is N/A to
this parcel's .bb/.js files). Co-change report shows only the expected,
already-touched siblings of `master_main_reconcile_lib.bb`.

## Invariants (declared)
1. "A commit on local main is never discarded by the reconcile path while a
   plain 3-way merge with origin/main would have preserved it without
   conflict." — Encoded as example-based unit tests over
   `absorb-with-merge!`'s complete (2-boolean) input space in
   `master_main_reconcile_lib_test_runner.bb`; exhaustive over that domain,
   accepted as non-vacuous encoding (no fast-check property needed for a
   fully-enumerable 4-branch pure function, consistent with this module's
   own documented split between generative and example-based coverage).
2. "The reconcile path never leaves a conflicted merge in progress, and
   never aborts a merge it did not itself start." — Same file's
   `bl1214: abort! is called ONLY after this function's own merge!
   attempt failed` test, plus `may-abort-failed-merge?` reuse in
   handoffd.bb's adapter wiring. Confirmed.

Both invariants are adequately encoded at the pure orchestration layer.
**However, at the call-site (adapter) layer, two of the three executors
regress — see D1/D2 below.**

## D1 — `run-post-hotfix-merge!` drops finish-ok bookkeeping for the ordinary fast-forward-success case (behavior, HIGH — production exit-code regression)

File: `swarmforge/scripts/post_hotfix_merge_origin_lib.bb`, `:ff-absorb`
branch of `run-post-hotfix-merge!`:

```clojure
(let [result (master-main-reconcile-lib/absorb-with-merge! {...})]
  (if (= (:outcome result) :merged)
    (finish-ok daemon-dir rev-counts! :merged)
    result))
```

`absorb-with-merge!` returns `{:success true :outcome :ff}` (not `:merged`)
for the ordinary, most common case — a plain fast-forward with no
divergence at all. That case now falls into the `else` branch and returns
the BARE `absorb-with-merge!` result verbatim, which carries no `:ok?` and
no `:exit` key, and never runs `finish-ok` (so the deadlock marker is never
cleared).

Production impact: `post_hotfix_merge_origin.bb`'s CLI does
`(System/exit (or (:exit result) 1))` — a plain successful fast-forward now
exits **1** (reported as failure) instead of **0**. `swarm_heal.bb` reports
`"ok?":null` for the same ordinary case in its health JSON.

**Confirmed as a genuine regression, not pre-existing**: on this commit,
`post_hotfix_merge_origin_lib_test_runner.bb` has 4 failures (`success ok`,
`success exit 0`, `success outcome merged`, `deadlock cleared when behind
0`) — all in the file's pre-existing, unmodified "success merges after
fetch" scenario. The identical test passes cleanly on the pre-BL-1214
baseline (c416f9460, verified via a throwaway worktree A/B).

Remediation: treat any `:success true` outcome uniformly, e.g.
`(if (:success result) (finish-ok daemon-dir rev-counts! (:outcome result)) result)`,
or explicitly branch `:ff`/`:merged` to the same `finish-ok` call.

## D2 — `test_swarm_heal_push_before_reset.sh` §2 is now red: its assertion encodes the PRE-BL-1214 behavior for the exact case this ticket changes (behavior, MEDIUM — stale standing test)

File: `swarmforge/scripts/test/test_swarm_heal_push_before_reset.sh`, §2
("the ticket's own regression guard: a GENUINE two-way divergence").

The scenario seeds a genuine, non-conflicting two-way divergence (origin
commits `origin-only.txt`, local commits `local-only-2.txt` — disjoint
paths) — precisely the case BL-1214 changes from discard-by-reset to
absorb-by-merge. The test's header comment and assertions still say "the
existing reset-to-origin recovery must still fire exactly as it did before
this ticket, discarding the local-only commit" and assert
`CURRENT_SHA == ORIGIN_SHA` / the local-only commit is NOT reachable.

Confirmed as a genuine regression, not pre-existing: green on c416f9460,
red on this commit. The actual (correct, per-ticket) new behavior is
visible in the failing run's own diagnostic output —
`"ok?":true,"outcome":"merged"` — i.e. `swarm_heal.bb`'s own real-git call
site IS now merging and preserving the local-only commit, exactly as
BL-1214 intends. Only the test's assertions are stale.

The coder updated the equivalent standing test at the handoffd.bb call site
(`test_handoffd_master_main_reconcile_wiring.sh` scenario 02, pre-existing,
now green) but did not update this sibling test guarding the identical
invariant at the swarm_heal.bb/post_hotfix_merge_origin_lib.bb call site,
leaving the suite red.

Remediation: update §2's header comment and assertions to expect
merge-and-preserve (both `ORIGIN_SHA` and `DISCARDABLE_SHA` reachable from
main, tip is a 2-parent merge commit) — mirroring
`test_handoffd_master_main_reconcile_wiring.sh` scenario 02's own
assertions — rather than discard-by-reset. If a genuinely-discarded case is
still wanted as a regression guard elsewhere, it must use conflicting
content (same path on both sides), not this disjoint-path setup.

## Verdict
Send back to coder. Both defects are in the same commit (6b08f29d2) and
the same invariant family (BL-1214's own two declared invariants, at the
call-site layer) — one bounce, both items.
