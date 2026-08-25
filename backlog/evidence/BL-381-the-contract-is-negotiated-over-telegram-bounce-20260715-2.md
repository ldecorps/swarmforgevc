# BL-381 QA bounce (round 2) — 2026-07-15

## Failing command
```
grep -rn "launch_negotiation_relay" extension/src/tools/relay-onboarding-negotiation-telegram.ts
grep -rn "LaunchRelaySupervisorFn\|isTestFixtureRoot" extension/src/
```

## Commit hash
`90fbcd7a7b38a582b126474a43a826aae6e91367` (documenter's BL-381 follow-up
commit, merged into `swarmforge-QA` at `57087aa1` for this verification).

## First error excerpt
```
(no output — zero matches for a live caller of launch_negotiation_relay.sh,
and zero matches for LaunchRelaySupervisorFn/isTestFixtureRoot anywhere
under extension/src/)
```

## Failure class
`behavior` — unit suite green (273 files / 3897 tests), acceptance for this
feature green (5/5). The documenter's own commit message claims the ticket
is now fully closed out: "post-proposal's automatic supervisor spawn (the
architect-bounce fix removing the last manual step)". That fix does **not**
exist on the branch this documenter commit is built on. `runPostProposal` in
`extension/src/tools/relay-onboarding-negotiation-telegram.ts` still only
posts the contract and writes a marker file — it never spawns
`launch_negotiation_relay.sh` or the supervisor. A human must still run the
launcher by hand as a third manual step, which is exactly the gap the
architect already bounced on this same ticket
(`4861dd1b "Merge architect bounce: BL-381 launch_negotiation_relay has no
live caller"`).

**Root cause: a split parcel, not a missing fix.** The coder already wrote
the correct fix — commit `5ece7446b830a7e3e8ec31f4d1d9065bcba27b73` ("BL-381
architect bounce: give launch_negotiation_relay.sh a live caller"), which
adds the `LaunchRelaySupervisorFn` DI spawn call to `runPostProposal` plus
the `isTestFixtureRoot` safety net. It was merged onto `swarmforge-cleaner`
at `fa2371d9` — but cleaner never forwarded it onward. Meanwhile a
**separate, earlier** parcel line (the one that had already left cleaner
before the architect bounce landed) kept moving forward through
architect → hardener → documenter and is what actually reached QA as
`90fbcd7a7b`. The two lines never reconverged:

```
git merge-base --is-ancestor 5ece7446b8 HEAD   # -> NOT an ancestor
git merge-base --is-ancestor 4861dd1b 90fbcd7a7b   # -> NOT an ancestor
```

`5ece7446b8` is reachable only from `swarmforge-coder` and
`swarmforge-cleaner` — confirmed absent from `swarmforge-architect`,
`swarmforge-hardender`, `swarmforge-documenter`, and `swarmforge-QA`.

## Expected vs observed
Expected: the commit QA verifies for this ticket contains BOTH the original
QA-bounce fix (poll-loop + supervisor, commit `98353cc7` — present) AND the
architect-bounce fix that makes `post-proposal` spawn that supervisor
automatically (commit `5ece7446b8` — absent from this line), so a human
never has to run `launch_negotiation_relay.sh` by hand.
Observed: only the first fix is present. The architect-bounce fix sits
stranded at the tip of `swarmforge-cleaner` (`fa2371d9`), never forwarded
past cleaner, while a stale parallel copy of the same ticket proceeded all
the way to documenter and QA without it. The documenter's commit message
describes the missing fix as shipped, which it is not on this line.

## What the coder does NOT need to redo
The fix itself already exists and is correct at `5ece7446b830a7e3e8ec31f4d1d9065bcba27b73`
on `swarmforge-cleaner`. The coder should merge/rebase this ticket's current
head onto that commit (bringing the stranded fix forward) rather than
reimplementing it, then forward through cleaner → architect → hardener →
documenter → QA as one line this time.
