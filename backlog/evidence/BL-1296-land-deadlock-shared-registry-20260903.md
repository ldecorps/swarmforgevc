# The land queue is deadlocked again — a different mechanism, and BL-1371 is the only exit

Specifier adjudication of QA's priority-`00` LAND_ESCALATE on BL-1296,
2026-09-03. QA's own evidence: `backlog/evidence/BL-1296-land-escalate-20260903.md`
(on `swarmforge-QA`).

## It is NOT the BL-1375 approval path — that fix works

BL-1375 landed (`c370d1e28a` is an ancestor of `origin/main`) and its narrowing
does what the human ruled. Verified by running the predicate, not by reading it:

```
BL-1309 -> {:state :approved, :blocking? false, :reason "BL-1309 is approved"}
BL-1356 -> {:state :approved, :blocking? false, :reason "BL-1356 is approved"}
BL-1359 -> {:state :approved, :blocking? false, :reason "BL-1359 is approved"}
blocking: []
```

All four siblings are `human_approval: approved` and filed unambiguously in
`backlog/paused/` on the working tree, local `main`, `origin/main` AND
`swarmforge-QA` — so no tree contributes a `hold`/`unreadable` verdict either.
My first two hypotheses (the expedite park leaving them in `backlog/hold/`, and
a stale copy in QA's worktree) were both wrong and are recorded as wrong.

## What is actually blocking: the rider meeting BL-1332

The refusal comes from the human's rider on BL-1375 — the replayed tree must
pass `check_feature_handler_registration.sh` before publish:

```
land-step replay: refusing to publish BL-1296 - the replayed tree is not
self-consistent with passenger sibling(s) ... riding on a shared path
(BL-1375 invariant 2 / BL-1324):
  - missing registry module: bl1309LandDecideStepEntanglementSteps.js
  - missing registry module: bl1356StampOffWatchesTheRunSteps.js
  - missing registry module: bl1359MergeChargedOnlyWithIntroducedSteps.js
```

The guard is right. Two settled rules combine into a new trap:

1. **BL-1332**: a shared path is replayed **whole**. `specs/pipeline/steps/index.js`
   is shared, so BL-1296's tip-pure replay carries every sibling's `require(...)`
   line whether it wants to or not.
2. **BL-1375's rider**: a passenger's content may ride only if the replayed tree
   is self-consistent on main.

A sibling's contribution is split across those two categories: its **require
line** lives in the shared file (rides whole) and its **handler file** is its
own path (excluded from another ticket's replay). So the line rides and the file
cannot follow. Dangling require, guard refuses, correctly.

## The circularity, proved rather than asserted

```
swarmforge-QA:specs/pipeline/steps/index.js  — requires present at lines
    38 bl1296BubbleSeatSteps, 953 bl1309…, 954 bl1356…, 955 bl1359…
origin/main:specs/pipeline/steps/index.js    — 0 of those four requires
origin/main handler files: bl1296BubbleSeatSteps.js  ABSENT
                           bl1309LandDecideStepEntanglementSteps.js  ABSENT
                           bl1356StampOffWatchesTheRunSteps.js  ABSENT
                           bl1359MergeChargedOnlyWithIntroducedSteps.js  ABSENT
```

Whichever of the four lands first replays `index.js` whole, carries the other
three requires, rides only its own handler file, and is refused on three
dangling modules. **Every one of the four is in that position**, so QA's "retry
once BL-1309/1356/1359 land their own handler files" has no first mover. This is
BL-1375's deadlock again, in a form approval state cannot dissolve — and unlike
the first one, no ruling about refusal width can reach it.

## BL-1371 is the only exit, and it cannot ride the pipeline it repairs

QA is right that this is BL-1371 (`backlog/paused/`, the shared-registry
coupling) and right not to re-mint it. Two things follow that were not visible
before today:

1. **Its severity was understated.** It was `medium`, `priority: 16`, filed as a
   coupling that "every gate reports". It is now the sole unblock for four
   approved, QA-verified tickets and every future ticket touching the registry.
   Re-graded `critical`, `priority: 1` this pass.
2. **It cannot travel the normal pipeline.** Its own `required_wiring` reads
   `specs/pipeline/steps/index.js::bl1371StepDiscoverySteps` — its parcel
   registers an acceptance handler in the very file that is deadlocked, so its
   own land would be refused for exactly the same reason. This is the
   expeditor's charter verbatim: "when the defect is IN the swarm's own delivery
   machinery, the fix cannot ride the pipeline it is fixing." An expedite run
   merges its branch rather than replaying tip-pure, so it can land the handler
   file and its require line together.

Known costs of that route, all ticketed today and none of them blockers:
BL-1376 (the run will not name its unlanded branch — check
`git branch --contains` afterwards), BL-1378 (its `active/`->`done/` close move
will be refused by the QA-mailbox guard), BL-1379 (it will park the active queue
into `backlog/hold/` and not reverse it).

## One faster route, flagged for QA rather than mandated

The handler `.js` files are inert until something requires them. Landing the
three missing files alone — no `index.js` change — would make every subsequent
replay's requires resolve, and each ticket could then land normally.

I am not directing this, because it is integration and therefore QA's call
(Article 1.8), and it carries two real risks that must be checked first:
`check_feature_handler_registration.sh` may also refuse the reverse shape (a
handler file present and unregistered), and it lands another ticket's code
ahead of that ticket's own land. If QA judges both acceptable it is much cheaper
than an expedite; if not, the expeditor stands.

## Disposition

- No new ticket. BL-1371 already owns this and QA said so first.
- BL-1371 amended in place (severity, priority, notes) — it is `paused`, not in
  flight, so no worktree-staleness hazard.
- Coordinator notified priority `00`: promote BL-1371, and expect to expedite
  rather than route it.
- BL-1296's QA approval stands. Nothing in its own domain failed.
