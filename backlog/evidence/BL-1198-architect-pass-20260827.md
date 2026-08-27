# BL-1198 architect pass — 2026-08-27

## Reviewed commit

`daefb98c6d` (coder), merged into architect at `78ea097c5` (backlog
surgery declined and reverted separately — see
`BL-1198-architect-declines-cleaner-backlog-surgery-20260827.md`).

## Implementation review

- `master_main_reconcile_lib.bb`'s new `rematch-with-push-first!` is a
  small, well-isolated orchestration primitive: takes injected `:push!`/
  `:reset!` adapters, tries push once, falls through to `reset!` only on
  failure, passes `reset!`'s result through verbatim on the genuine-
  divergence path (no caller-visible contract change there).
- All three real reset call sites now route through it:
  `handoffd.bb`'s `master-main-rematch-onto-origin!` (reuses
  `push-sweep-push!`, the existing adapter already defined in the same
  file — direct reuse, no new mechanism), `swarm_heal.bb`'s inline
  `:rematch!`, `post_hotfix_merge_origin.bb`'s `rematch-onto-origin!`
  (both of the latter two define a trivial local `git push origin main`
  one-liner as their `:push!` adapter).
- **Constraint check on the ticket's "reuse `push_sweep_lib.bb`, never an
  ad hoc call site" line:** verified `push_sweep_lib.bb` is pure decision
  logic (`push-decision`, backoff, gate refusals) with no git-shelling
  function of its own — the actual git-push adapter (`push-sweep-push!`)
  lives file-private in `handoffd.bb`, not exported. `swarm_heal.bb` and
  `post_hotfix_merge_origin.bb` cannot reuse it without requiring
  `handoffd.bb` wholesale (a daemon entry point, not meant as a shared
  lib). Their one-line `git push origin main` closures match this
  codebase's own established convention (each file injects its own thin
  git adapters into shared pure decision logic — visible in the same
  diffs' `:fetch!`/`:merge!`/`:reset!` closures, pre-dating this ticket).
  Not a second push *mechanism* (no retry/backoff of its own — the
  primitive's own docstring is explicit that BL-356's push-sweep owns
  retry/backoff, this is a one-shot pre-reset attempt only). Judged
  compliant with the constraint's intent, not a literal-text violation
  worth a bounce — the ticket's own reference to `push_sweep_lib.bb`
  as directly reusable was itself imprecise.
- Documentation-drift fix (`post_hotfix_merge_origin_lib.bb`'s "no
  reset/stash" → "never stash") is accurate — verified against the
  file's own `rematch!`-invoking branches, which do reset.

## Verification (run directly, not taken on the coder's word)

- `bb swarmforge/scripts/test/master_main_reconcile_lib_property_runner.bb`
  — 500 runs, ALL PROPERTIES HOLD, including
  `bl1198: reset never fires without push being attempted and failing
  first`, with its own non-vacuity check (mutant that always resets
  regardless of push outcome) printing "non-vacuity confirmed" — this is
  the ticket's own declared `invariants:` entry, correctly encoded per
  the Invariants Review requirement.
- `bb swarmforge/scripts/test/master_main_reconcile_lib_test_runner.bb`
  — ALL TESTS PASS, including the 3 new unit cases (push-succeeds/
  push-rejected-falls-through/reset-failure-passes-through-verbatim).
- `env -u GIT_DIR -u GIT_WORK_TREE bash
  swarmforge/scripts/test/test_handoffd_master_main_reconcile_wiring.sh`
  (real-git wiring lane, isolated `mktemp` fixtures — safe to run) — ran
  it myself rather than trusting the coder's report: confirmed exactly
  one FAIL ("scenario 02", the genuine two-way-divergence case), every
  other scenario PASS. Matches coder's own evidence
  (`BL-1198-preexisting-two-way-divergence-reset-defect-20260827.md`)
  exactly: this is a pre-existing, differently-shaped defect (missing a
  real 3-way merge attempt before falling to reset for non-conflicting
  divergence) explicitly excluded by this ticket's own `out_of_scope`
  ("redesigning when a rematch/reset is TRIGGERED"). Correctly disposed
  by the coder via note, not fixed here, not ticketed by me either
  (already flagged once; a second note would just duplicate it).

## Not applicable to this parcel

`extension/`'s dependency-cruiser gate and co-change tool are scoped to
the TypeScript extension; this ticket is pure `swarmforge/scripts/*.bb`
infra with no `extension/` touches — both tools would report nothing
relevant. Babashka has no mutation/CRAP/DRY tooling per engineering.prompt
("gated ONLY by their own unit-test suite") — the two `bb` runs above
plus the real-git wiring shell test are the full applicable verification
surface, all run directly.

## Disposition

Architecturally compliant, invariant correctly encoded and verified
non-vacuous, pre-existing out-of-scope defect correctly identified and
disposed rather than silently absorbed or hidden. Forwarding to hardener.
