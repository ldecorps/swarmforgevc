# BL-966: production code is on main; its HARDENING is not — verified

Raised by: hardener ("BL-966 code rode to main via BL-961; its hardening tests did not -
keep active"). **Verified. Correct, and more precise than the earlier entanglement note.**

## What IS on origin/main
BL-966's coder commit `5c8b0835f`, including the production lib and the coder's own
tests. Behaviour is correct — verified live, read-only: master, `.worktrees/architect`
and `.worktrees/coder` all answer **7** (pre-fix: 7 / 3 / 3).

`backlog_depth_lib.bb` and `bl966_depth_identity_root_property_runner.bb` are
**byte-identical** across origin/main, swarmforge-QA and swarmforge-hardender. So main is
NOT running an older production build — that was the first hypothesis, and it is wrong.

## What is NOT on main
Four BL-966 commits are absent from origin/main, the load-bearing one being:

    b325064ca  BL-966: hardening pass - a hand-authored mutation sweep left 4
               survivors; all 4 closed, sweep now 7/7 killed.
    137a077aa  BL-966: architect review pass 1 - complete inventory, PASS
    f0a7e739a  BL-966: document the per-checkout depth-cap split and its fix
    773c19495  Merge documenter BL-966 into QA

Per-file, main vs QA:

    backlog_depth_test_runner.bb                      DIFFERS  (hardened tests absent)
    BL-966-depth-cli-same-answer-...feature           DIFFERS  (scenarios absent)
    BL-966-hardening-20260820.md                      ABSENT   (main sha = empty tree)

## The actual risk, stated exactly
Main carries the right production code guarded by the **weaker, pre-hardening test
suite**. The four mutants the hardener closed are live-uncovered on main: today's
behaviour is correct, but a future regression in those four paths would not be caught by
anything currently on main. This is a coverage gap, not a behaviour defect — worth stating
plainly so nobody reads "verified 7/7/7" as "BL-966 is done".

## Action
None available to the coordinator, and none needed. BL-966 stays **active** and is held
by QA; completing its normal chain lands the hardening. The hardener's "keep active" is
the correct call and is already the state. Do NOT close BL-966 on the strength of its code
being on main — that is precisely the trap this file exists to flag.
