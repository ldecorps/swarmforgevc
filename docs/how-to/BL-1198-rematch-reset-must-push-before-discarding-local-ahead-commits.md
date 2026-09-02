# Rematch reset pushes local-ahead main before ever discarding it (BL-1198)

> **Superseded on the genuine-rejection case (BL-1310).** "Push rejected
> (genuine divergence) → today's reset proceeds unchanged" below is no
> longer true: as of BL-1310 the reset only ever fires when the ahead-count
> is a known zero. A genuine rejection with `ahead > 0` now refuses instead
> of resetting. See
> [BL-1310](BL-1310-reconcile-refuses-instead-of-discarding-local-ahead-commits.md)
> for the current behavior. The push-first attempt described here is
> otherwise unchanged.

Every `git reset --hard origin/main` call site in the master/main-rematch
path used to assume, unconditionally, that any local-ahead commit was
disposable the moment local `main` and `origin/main` collided. "Local main
is ahead and collides with origin" and "those ahead commits are disposable
bookkeeping" are two different facts, and nothing checked the second before
discarding it — a reset could silently eat real, only-reflog-recoverable
work whenever local main simply hadn't been pushed yet, not just when it
had genuinely diverged.

## Fix

Before any of the three real `git reset --hard origin/main` call sites
fires, it now attempts `git push origin main` exactly once first, through
one shared primitive (`rematch-with-push-first!` in
`master_main_reconcile_lib.bb`, the file all three sites already
`load-file`):

- **Push succeeds** — local main was never really diverged, just racing a
  moment where origin hadn't caught up yet. Ahead becomes 0 by construction:
  the commit is now on origin too, and no reset happens. A silent,
  reflog-only-recoverable loss becomes a plain, loss-free fast-forward.
- **Push is rejected (non-fast-forward)** — origin has genuinely diverged.
  Today's reset proceeds exactly as before; this is the real "colliding"
  case the reset path exists for, unchanged.
- **Push fails for any other reason** (remote unreachable, no credentials,
  network down, hook policy) — as of [BL-1288](BL-1288-only-a-rejected-push-authorises-discarding-local-commits.md),
  this is no longer treated as divergence. The commits are kept and the
  push's own error is returned as `{:success false :outcome
  :push-unavailable :error <the push's own error>}`. Only a recognised
  non-fast-forward rejection reaches the reset.

## Where it lives

| Call site | File |
| --- | --- |
| Shared primitive | `swarmforge/scripts/master_main_reconcile_lib.bb` — `rematch-with-push-first!` |
| Daemon reconcile | `swarmforge/scripts/handoffd.bb` |
| Manual heal | `swarmforge/scripts/swarm_heal.bb` |
| Post-hotfix merge | `swarmforge/scripts/post_hotfix_merge_origin.bb` |

A documentation-drift fix rode the same pass:
`post_hotfix_merge_origin_lib.bb`'s own top comment claimed "no
reset/stash" while its rematch path did reset — corrected to "never stash"
to match actual behavior.

## An honest limit, worth knowing before you touch this

Every dispatch path into `:rematch!` is gated `(zero? (or behind 0)) ->
:noop` first, so reaching rematch at all structurally requires a genuine
`behind > 0` divergence at decision time. Within one synchronous CLI
invocation, the push that follows happens milliseconds later against the
same unmoved origin, so real-git wiring tests (`test_swarm_heal_push_
before_reset.sh`) cannot themselves discriminate the fix — reverting the
fix back to a bare reset produces byte-identical PASS output on that test.
That existence proof lives in the `bl1198` property test instead (fake
push/reset adapters + its own non-vacuity check), which does catch a
mutant that always resets regardless of push outcome. The wiring test still
earns its place — it proves the plumbing reaches the shared primitive and
guards the genuine-divergence reset path against regression — but do not
try to "fix" it into a discriminating test by chasing an unreachable
push-succeeds scenario through real git.

## Related

- [BL-1288 only a rejected push may authorise discarding local-ahead commits](BL-1288-only-a-rejected-push-authorises-discarding-local-commits.md)
- [BL-1214 `:ff-absorb` attempts a real 3-way merge before resetting local main away](BL-1214-ff-absorb-attempts-real-merge-before-reset.md)
- [BL-891 master-main reconcile](BL-891-master-main-reconcile-sweep.md)
- [BL-1141 refuse-rematch executes live](BL-1141-bl1138-residual-refuse-rematch-not-executed.md)
- [BL-1124 property fixtures must not mutate shared main](BL-1124-property-suite-fixtures-must-not-mutate-shared-main.md)

Acceptance:
`specs/features/BL-1198-main-rematch-reset-must-attempt-push-before-discarding-local-ahead-commits.feature`
