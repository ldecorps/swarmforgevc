# One orphan handler on main crashes every acceptance run — adjudication of QA's note, 2026-09-04

QA's priority-`00` note (08:18Z): "origin/main acceptance runner crashes on ANY
feature (BL-1296 handler gap)". Specifier adjudication, facts verified on
`main` at `6ca2cff386`, not argued from the note.

## What crashes, and why it is only one file

Loading every top-level `specs/pipeline/steps/*Steps.js` on `main` in a
try/catch: **947 handlers, 1 fails** — `bl1296BubbleSeatSteps.js`:

    Cannot find module '/home/carillon/swarmforgevc/extension/out/tools/bubbleSeat'

Line 21 of that handler requires `path.join(EXT_ROOT,'out','tools','bubbleSeat')`
— the compiled form of `extension/src/tools/bubbleSeat.ts`, which is **on no
branch that `main` can see**: it lives only on BL-1296's parcel
(`e7cec9a261`, on `swarmforge-QA` / `swarmforge-documenter` /
`swarmforge-hardender`), and BL-1296 sits in `backlog/paused/`, QA-approved
on 2026-09-03 but never landed (its land escalated on the shared-registry
deadlock).

Under BL-1371's discovery (`5a54d66774`, landed 2026-09-03 16:57 BST),
`index.js` requires every discovered handler EAGERLY at module load and, by
BL-1371's own invariant 2, a file that cannot be required fails the whole
run loudly. So one unloadable handler = no feature can run. That invariant
is correct and stays; the defect is that a handler in that state reached
`main` at all.

## How it got there

`a93aa4a18f` ("Land orphaned step-handler scaffolding files to clear the
shared-registry land deadlock", **2026-09-04 01:31 BST — seven hours AFTER
discovery landed**) hand-landed nine handler files plus one helper. Its body
says QA "independently re-checked every one of the nine files' own requires
before landing ... so nothing this commit adds is left with a dangling
require". That check was run in QA's worktree, where BL-1296's source IS
present and `extension/out/tools/bubbleSeat.js` compiles — so the require
resolved there and could not resolve on `origin/main`. The route's own
caveats (specifier, `BL-1296-land-deadlock-shared-registry-20260903.md`)
named `lib/` siblings and `require('./x')` forms; neither covers a compiled
production module from an unlanded parcel, and the text-pattern check reads
`path.join(__dirname,'lib',…)` forms only. Neither party was careless; the
check was answered by the wrong tree.

Two things made the route unsafe at the moment it was used:

1. Its premise was already gone. The "handler files first" route existed to
   break the BL-1332/BL-1375 deadlock on the shared `index.js` array. BL-1371
   removed the array, and with it the deadlock, before this land ran.
2. Under the array, a present-but-unregistered handler was inert. Under
   discovery, presence IS registration, and a present handler that cannot
   load is a swarm-wide red. The route's safety argument
   ("`collectUnregisteredHandlers` never examines a handler whose `.feature`
   is not on the tree") is about the registration GUARD, not about the
   RUNNER — and the runner is what loads.

The commit passed `run_commit_guards.sh` because the only handler guard in
that set, `check_feature_handler_registration.sh` (BL-1303, narrowed by
BL-1371), checks registration and reachability and **never loads a
handler**. The land path's tree guard is the same script
(`land_step_lib.bb:928`). Nothing on either path asks "does this handler's
module graph resolve on THIS tree?".

## Remedies

**Immediate (QA's — pipeline code on `main`, Article 1.8/4.2):** land
BL-1296 properly. It is QA-approved, its parcel is on `swarmforge-QA` at
`e7cec9a261`, the deadlock that refused it no longer exists, and its handler
is already on `main` — the replay adds the production module, its tests and
docs, after which the handler loads. If that land is refused for a reason of
its own, the fallback is to remove `specs/pipeline/steps/bl1296BubbleSeatSteps.js`
from `main` until BL-1296 lands; that returns `main` to its pre-01:31 state,
where BL-1296's feature (on `main` since 2026-08-30, `c657656462`) throws
only when it is itself run. Recommended: the land, not the removal.

**Durable (specified as BL-1385):** the land tree guard and the commit guard
must prove every discovered handler's module graph resolves on the tree
under test — a handler that cannot load refuses the land or the commit,
naming the handler and the missing module. The verdict is a function of the
tree, never of the checking worktree.

**Retired:** the "handler files first" fast route. Under discovery it is
exactly the hazard BL-1371's how-to warns about ("a half-finished
`*Steps.js` file on a branch now breaks that branch's acceptance runs
immediately"), and its reason to exist ended with BL-1371.

## Not a QA bounce, not a specifier bounce

No parcel is being sent back: the crash is on `main` itself, made by a
hand-land, and repaired by a hand-land. Recorded so the next reader of the
route's evidence sees why it must not be reused.

By specifier.
