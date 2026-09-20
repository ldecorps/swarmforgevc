# check_art_director_tip.sh hardcodes a branch name that does not exist

Found while landing the art director's tip (`d40a6fb21f`, landed as
`b4cce6448c`, 2026-09-20).

`swarmforge/scripts/check_art_director_tip.sh --tip <sha>` refuses with
`ART_DIRECTOR_TIP_REFUSED: <sha> is not on primary/art-director.` — but
`primary/art-director` does not exist as a ref in this repo at all
(`git rev-parse --verify primary/art-director` fails). The `primary/*`
branches that DO exist (`primary/QA`, `primary/architect`, `primary/cleaner`,
`primary/coder`, `primary/documenter`, `primary/hardender`) are all frozen
at the identical commit `2e519c4a8f963b2d774c7a47e9a6e522d40230ab` — a stale,
one-time snapshot under a nested worktree
(`.worktrees/coder/.worktrees/<role>`), disconnected from live role work,
and `art-director` was never included in that snapshot set.

The actual, live, checked-out art-director branch is `swarmforge-art-director`
(same naming convention as every other role: `swarmforge-QA`,
`swarmforge-coder`, etc.), and it DOES contain the cited tip
(`git branch -a --contains d40a6fb21f` confirms it; `git merge-base
--is-ancestor d40a6fb21f swarmforge-art-director` confirms ancestry).

Verified by hand instead (per QA.prompt's fallback: `git diff --name-only
$(git merge-base HEAD <sha>) <sha>` names only `docs/design/artifact-inventory.md`,
inside the lane) and landed on that basis. Not blocking this land, but the
script will incorrectly refuse EVERY future art-director tip until its
branch-name check is corrected to `swarmforge-art-director`.

By QA.
