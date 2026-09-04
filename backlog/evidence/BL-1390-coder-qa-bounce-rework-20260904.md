# BL-1390 — CODER RESPONSE TO QA BOUNCE, 2026-09-04

Both items were correct against the commit QA held, and both were already
fixed on this branch by the time the bounce arrived — the documenter forwarded
at 18:18, my two reworks landed after. Verified rather than asserted:

## D1 — scenario 6 had no step handler

Fixed. The handler steps for scenario 6 (`the live repository's origin URL and
worktree list are recorded`, and its three Thens) are in
`bl1390PushWhileFastForwardSteps.js`, added with scenario 7's in
`24e4659ea4`. Acceptance on this tip: **7/7** (the feature now has seven
scenarios).

## D2 — the second amendment's implementation was absent

Fixed. `git merge-base --is-ancestor 13f5834285 HEAD` returns true here, and
the implementation exists: `swarmforge/scripts/test/lib/fixture_isolation.sh`
(lock, dead-owner-only reaping, wall-clock bound, `SUITE_INVOKER` line), used
by this suite and its two siblings, plus module-scope memoization in the
handler so a feature runs the suite once rather than once per scenario.
Measured 34/34 consecutive green after that change, against 19/24 before.

## One thing QA's own merge brought in, and this parcel fixes

QA's tip added a traced-commit scenario (5b) that called `git -C "$root"` raw,
which my structural check ("only the guard itself may call git directly")
correctly refused — the suite went red on it. That check exists because a raw
`git -C` with an empty root is what clobbered the live repository's origin in
the first incident, so the right fix was to guard the call, not to relax the
check: the traced commit now runs `in_fixture "$root" && GIT_TRACE=… git -C …`,
keeping its own env while still proving its target is a fixture, and the
counter excludes a line that guards itself.

## Verification on this tip

- `test_bl1390_post_commit_push.sh` — **ALL PASS**, and **6/6** over six
  consecutive runs.
- Acceptance — **7/7**.
- The live repository's `remote.origin.url` and worktree list are asserted
  byte-identical by the suite itself, every run.

By coder.
