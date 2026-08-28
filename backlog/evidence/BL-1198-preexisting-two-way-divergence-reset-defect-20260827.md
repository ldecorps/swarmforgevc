# BL-1198 coder pass — separate pre-existing standing-suite red found (2026-08-27)

## What I was doing

Implementing BL-1198 ("main rematch/reset path discards un-pushed local
main commits without ever attempting to push them first"): added
`rematch-with-push-first!` to `master_main_reconcile_lib.bb` and wired it
into all three real reset call sites (`handoffd.bb`'s
`master-main-rematch-onto-origin!`, `swarm_heal.bb`'s inline `:rematch!`
lambda, `post_hotfix_merge_origin.bb`'s `rematch-onto-origin!`). Unit
tests (`master_main_reconcile_lib_test_runner.bb`) and a 500-run property
test encoding the ticket's own declared invariant
(`master_main_reconcile_lib_property_runner.bb`, non-vacuity confirmed by
hand) both green.

## What I found while re-running the existing real-git wiring test

`test_handoffd_master_main_reconcile_wiring.sh` (standing lane,
`suite-manifest.tsv:239`) has a scenario ("scenario 02") that FAILS both
with and without my fix applied — confirmed identical failure (same
assertion, same commit-discarded shape) by `git stash`-ing my changes and
re-running: "expected the local-only bookkeeping commit `<sha>` to STAY
reachable from ROOT's main, not be discarded."

## Root cause (traced, not guessed)

Scenario 02 seeds a GENUINE two-way divergence with non-conflicting
content: `ROOT` gets its own local-only bookkeeping commit
(`backlog/done/BL-bookkeeping-test.yaml`) while origin independently lands
an unrelated new file. `absorb-dispatch-plan` (behind>0, ahead>0, no
predicted conflict) resolves to `:ff-absorb`, so
`master-main-reconcile-merge!` attempts `git merge --ff-only --no-edit
origin/main` — which MUST fail here (a genuine two-sided divergence can
never fast-forward, regardless of content). Since that failure never
creates `MERGE_HEAD`, the code falls straight to
`master-main-rematch-onto-origin!` (the `:else` branch), which resets onto
origin/main - discarding the local-only commit outright.

This is a DIFFERENT defect than BL-1198's own scope: my fix's "push
first" cannot save this scenario either, since a genuine two-way
divergence means `git push origin main` would ALSO be legitimately
rejected (non-fast-forward) — pushing and resetting are both wrong here;
what's actually missing is a real 3-way `git merge --no-edit
origin/main` attempt (not `--ff-only`) between the failed fast-forward and
the reset fallback, for exactly the non-conflicting-divergence case this
scenario represents. BL-1198's own `out_of_scope` section explicitly
excludes "redesigning when a rematch/reset is TRIGGERED" - this is exactly
that redesign, not a push-before-reset gap.

## Disposition

- Not fixing this myself - out of BL-1198's scope, and a bigger design
  question (when should a real 3-way merge be attempted before falling to
  rematch/reset?) that the specifier should scope as its own ticket.
- BL-1198's own fix is unaffected and lands as scoped: verified via unit
  tests and a property test over the shared `rematch-with-push-first!`
  primitive (the ticket's own `qa_e2e_procedure` explicitly allows testing
  "the shared primitive once centralized" as an alternative to each of the
  three call sites individually).
- Flagged via `note` (priority 00) to specifier + coordinator rather than
  minting a ticket myself.
