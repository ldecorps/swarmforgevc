# BL-1310 — the reconcile reset destroyed seven commits, and nothing but the reflog knew

**Written:** 2026-08-31, by the specifier, from an idle `ready_for_next.sh`
returning `NO_TASK`.
**Recovery:** complete. All five commits carrying content were replayed with
`git cherry-pick -x` (zero conflicts) and pushed to `origin/main` in the same
turn; `git rev-list --left-right --count main...origin/main` is `0 0`.

## How it was found — by accident, not by a signal

Nothing reported this. The tell was a memory recording BL-1309 as minted while
`find backlog specs -name '*1309*'` returned nothing and
`git log --all --grep=BL-1309` was empty. A whole ticket had vanished with no
trace anywhere except `git reflog`.

## What the reflog showed

    7787cd650d HEAD@{2026-08-31 03:24:49 +0100}: reset: moving to origin/main

Divergence immediately before it, measured from the two SHAs:

    git rev-list --left-right --count 7787cd650d...59c70e666a  ->  31   7

31 behind, 7 ahead. `git merge-base --is-ancestor 7787cd650d 59c70e666a` is
false: a genuine two-way divergence, so `git push origin main` was legitimately
rejected non-fast-forward, and BL-1288's `push-rejection?` rule correctly
authorised the reset. **Every shipped guard behaved as specified.** The loss is
not a guard failing; it is that no guard is about the commits.

## The seven commits

| SHA | What it was | On main now? |
|---|---|---|
| `194b11287e` | BL-1309 mint — 181-line ticket YAML + 50-line feature draft | recovered `a756daa0bd` |
| `d6fd8b6eb6` | BL-1309 topic record (announcement already posted, ts 1788142309337) | recovered `9bf12d904d` |
| `949d3f18b3` | `hardender.prompt` — an ACCEPTED `rule_proposal`, 32 lines | recovered `53491683db` |
| `e35d9a873d` | BL-1300 re-priced ruling — 94-line YAML amendment + 108-line evidence | recovered `3373698f84` |
| `4fc530b180` | BL-1307 landed-park evidence, 73 lines | recovered `f97b4f2958` |
| `59c70e666a`, `6d3bb6d9bd` | BL-1302 topic records | superseded by `aaca1f6f9b`, not replayed |

Two of these were not merely work-in-progress:

- `949d3f18b3` was an accepted rule proposal. The hardender had been told its
  proposal was accepted. For about an hour the accepted rule did not exist.
- `e35d9a873d` existed specifically to stop a human tapping a ruling on a
  premise that was no longer true. Its destruction restored the false premise.

## Why the reflog is not a safety net

The discarded commits are unreachable. `gc.reflogExpireUnreachable` and any
`git gc` end the recovery window silently, and the swarm's own memory already
carries a standing "never `git gc` or `prune`" warning **because** these objects
are the casualties. A safety mechanism whose correctness depends on never
running a routine git command is not a mechanism.

Recovery has worked every time it has been attempted, with zero conflicts, on
every recorded occurrence. That is not evidence the situation is safe — it is
evidence that the only thing ever missing was somebody noticing.

## The path, read from source rather than inferred

- `handoffd.bb:3237` — the `:replay-bookkeeping` branch logs
  `predicted-conflict-colliding-local-ahead` and calls
  `master-main-rematch-onto-origin!`.
- `handoffd.bb:3175` — that function's `:reset!` adapter is
  `git reset --hard origin/main`. It replays nothing, despite the plan's name.
- `master_main_reconcile_lib.bb:814` — `rematch-with-push-first!` calls
  `(reset!)` on `push-rejection?`, and `:809` documents the reset's return value
  passing through "completely unchanged, so no caller-visible contract changes
  on the genuine-divergence path".
- `master_main_reconcile_lib.bb:214` — `absorb-would-conflict?` routes to
  `:replay-bookkeeping`, which is how a conflicting divergence with local-ahead
  commits reaches the reset at all.

There is no preservation step anywhere on that path: no branch, no tag, no
stash, no listing of the discarded SHAs in any log line.

## Cadence, not incident

Three `reset: moving to origin/main` entries are dated 2026-08-31 alone
(01:34:39, 01:42:59, 03:24:49). The swarm's memory records the historical count
at 148. The actor is `master_main_reconcile_lib.bb` driven by `handoffd.bb`,
gated by `config master_main_reconcile_enabled` — `true` in
`swarmforge/swarmforge.conf:349`, deliberately re-armed by the operator on
2026-08-29 (`cce70d985`) to clear a durable main-sync deadlock. **ON was a
reasoned human decision and OFF has its own real cost.** This evidence is not an
argument for turning it off; it is an argument that ON should not mean
destructive.

By specifier.
