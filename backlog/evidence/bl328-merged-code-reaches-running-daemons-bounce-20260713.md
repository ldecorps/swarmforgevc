# BL-328 QA bounce evidence — 2026-07-13

## Failing command
```
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-328-merged-code-reaches-running-daemons.feature
```

## Commit hash
`e176d6cc8c` (documenter's forward; underlying implementation from coder commit
`699f93e137`, cleaner `a31b900b2b`, architect merge `111a6f5d2e`)

## First error excerpt
```
# Subtest: A supervisor respawn brings up the current build, not the dead process's build
not ok 5
  error: `Scenario "...": no step handler matched "Given no build sync has run since that merge"`

# Subtest: A crash in the window between a merge and the sync does not re-arm the stale build
not ok 6
  error: `Scenario "...": no step handler matched "Given no build sync has run since that merge"`

# Subtest: If the current build cannot be produced, the process still comes back, loudly degraded
not ok 7
  error: `Scenario "...": no step handler matched "Given no build sync has run since that merge"`
```
(6 of 9 scenarios pass cleanly on a fresh `npm run compile` — not a stale-build
artifact, and not a regression in the original detection/report/sync scope.)

## Failure class
`behavior` — the ticket's own scope item 4 ("THE SUPERVISOR MUST NOT RE-ARM THE
STALE BUILD") was never implemented for the respawn path, not merely untested.

## Expected vs observed
Expected: `front_desk_supervisor.bb`'s `spawn-bridge!`/`spawn-bot!` check build
freshness themselves before respawning a crashed process — cheap freshness check
first, recompile ONLY when actually stale (bounded to once per merge, not once
per crash-loop iteration), respawn on the current build; if the current build
cannot be produced, still bring the process back up on the stale build with a
LOUD warning rather than refusing to respawn (a dead front desk takes the
human's only channel with it — degraded-and-visible beats dead).

Observed: verified directly in `swarmforge/scripts/front_desk_supervisor.bb` —
`spawn-bridge!`/`spawn-bot!` unconditionally `node <entrypoint>` against
whatever is currently in `extension/out/`, with zero freshness check and zero
recompile call. The build only re-stamps its own identity on `:re-armed`
(useful for the detection/report half, but not a fix) — a supervisor respawn
faithfully re-arms whatever build happens to be sitting in `extension/out/` at
that moment, stale or not. This is exactly the "system self-heals back to
broken" failure this ticket's scope item 4 exists to forbid.

## Root cause (why this happened, not just what broke)
Same class of gap as three earlier bounces this session
([[bl325-human-in-the-loop-bounced]], [[bl317-routing-manifest-bounced]]):
the specifier amended the ticket AND its feature file on `main` (commit
`204e31b`, "the respawn path must make the build current itself, not assume a
sync already ran") in direct response to the architect's own rule_proposal
about "an untested crash-before-sync window" on an earlier build of this same
ticket. The delivered commit (`e176d6cc8c`) never merged `main` to pick it up
— confirmed via `git merge-base --is-ancestor 204e31b e176d6cc8c` (false).

Notably, the amendment's own commit message explains the ORIGINAL scenario 04
("A supervisor respawn brings up the current build") passed even in the
pre-amendment build precisely because its fixture staged the sync BEFORE the
crash — proving the easy case while being named as though it proved the hard
one. The amendment corrects scenario 04's own Given clause to make that
easy-case fixture illegal, and adds scenarios 07/08 to pin the actual race
window. This is a real, separate, and more subtle finding than the earlier
bounces — worth noting alongside it: a generalized testing rule ("check that a
test's fixture has not already satisfied the condition it claims to prove")
was accepted into `hardender.prompt` in the same commit.

## What to fix
1. Merge `main` (picks up `204e31b`'s amended scenario 04/05 and new
   scenarios 07/08).
2. Add a freshness check inside `spawn-bridge!`/`spawn-bot!` (or a shared
   pre-spawn hook both call): compare the process's own build identity against
   `main`'s current SHA; if stale, recompile ONCE (bounded — not per crash
   iteration) before respawning; if recompile fails, respawn anyway on the
   stale build with a loud warning logged, never refuse to respawn.
3. Wire scenarios `merged-code-reaches-daemons-07`/`-08`'s step handlers in
   `specs/pipeline/steps/mergedCodeReachesDaemonsSteps.js`.
4. The original detection (`report`)/coordinator-invoked (`sync`) scope is
   correct and verified working — do not rebuild it.
