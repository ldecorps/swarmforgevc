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

---

# Addendum, same pass: BL-1360 escalates identically, and the fast route is verified clean

QA's second priority-`00` escalation of this class arrived while the first was
being adjudicated (`backlog/evidence/BL-1360-land-escalate-20260903.md`, on
`swarmforge-QA`). Same mechanism, larger: **9 missing handler modules** now.

    bl1296BubbleSeatSteps.js  bl1309LandDecideStepEntanglementSteps.js
    bl1356StampOffWatchesTheRunSteps.js
    bl1359MergeChargedOnlyWithIntroducedSteps.js
    bl1367ApprovalCarriesItsRulingSteps.js  bl1374SyncMergePassengersSteps.js
    bl1376ExpediteBranchHandoverSteps.js    bl1377SuiteBaselineSteps.js
    bl1378ExpediteCloseGuardSteps.js

QA is right that it is compounding rather than steady-state: three of those nine
are handlers for tickets minted **this morning** (BL-1376/1377/1378), which
means every ticket that reaches QA joins the jam. Since essentially every ticket
carries a new acceptance handler, the practical reading is that the land queue is
closed to new work until this clears.

## The guard is one-directional — checked in the assessor, not the docstring

My first note flagged the handler-files-first route as needing the guard checked
in both directions before anyone relied on it. Done, against
`extension/src/tools/featureHandlerRegistrationCheck.ts`:

- `collectUnregisteredHandlers` iterates `tree.featureFiles` and computes a
  ticket's `own` handlers only for a feature that is present. **A handler file
  whose `.feature` is not on the tree is never examined**, so it cannot be an
  `unregistered-handler` offender.
- `const scanned = registryReadable ? handlers.filter((p) => reachable.has(p)) : handlers`
  (line 208). An unregistered handler is unreachable, so it is not scanned for
  `missing-sibling-script` either — while the registry is readable.

So landing the nine handler `.js` files **alone** — no `index.js` edit, no
`.feature` files — offends nothing, and afterwards every replayed tree's
`require(...)` lines resolve. Each of the nine tickets can then land normally,
in any order, with no first-mover problem.

## The two caveats that had to be cleared, both now clear

1. **Sibling lib scripts.** Once a later land makes those handlers *reachable*,
   they ARE scanned, so anything they reach under `specs/pipeline/steps/lib/`
   must be on main. Checked all nine against `extractSiblingScripts`'s three
   quoted forms: **none references a sibling lib script.**
2. **Transitive requires.** `visitRequiredModule` walks requires from the
   registry, so a handler's own `require('./x')` must resolve too. Checked all
   nine: one dependency exists — `bl1359MergeChargedOnlyWithIntroducedSteps`
   requires `./lib/fixtureReaper` — and
   `specs/pipeline/steps/lib/fixtureReaper.js` is **already on `origin/main`.**

Nothing else is needed. Note that caveat 2 would NOT have been caught by
`extractSiblingScripts`, which only reads `path.join(__dirname,'lib',…)`-style
forms and not a plain `require('./lib/…')` — worth remembering before reusing
this check.

## Still QA's call, not mine

Landing pipeline code on `main` is QA's (Article 1.8/4.2, BL-247) and I am not
directing it. What changes with this addendum is that the route is no longer
speculative: the one question I could not answer in the first note is answered,
and the residual judgment is the narrower one of whether landing nine tickets'
handler files ahead of their own lands is acceptable. They are inert until
required, and each ticket's own approval is unaffected.

If QA judges it acceptable it clears all nine at once. If not, the expeditor
route on BL-1371 stands — but note BL-1371's parcel registers a handler in the
same deadlocked file, so it cannot travel the normal pipeline either.
