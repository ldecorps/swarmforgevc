# BL-1253 — coder rework of QA bounce D1, 2026-08-30

Bounce: `backlog/evidence/BL-1253-swarm-stamp-dead-feeder-owns-getupdates-2ec06b6ef1-bounce-20260830.md`
(one item, D1). QA's finding is correct about what QA held. The remedy is not
new code: **the work already existed and was stranded on this branch.**

## D1 — RESOLVED, by carrying a commit that never left the coder branch

`026ae2aa3` — "BL-1253: absorb retired BL-1260 - scenario 06 and invariant 3."
— adds exactly what the bounce asks for:

- the three step handlers for scenario 06 in
  `specs/pipeline/steps/bl1253DeadFeederOwnsGetUpdatesStampSteps.js`
  (`the bridge owns getUpdates because the heartbeat was stale`,
  `the front-desk poll heartbeat becomes fresh again during the run`,
  `the bridge returns to consuming the queue without being restarted`), and
- `extension/test/bl1253TokenOwnershipInvariants.property.test.js`, invariant
  3's property test, also carried from retired BL-1260.

That commit is on `swarmforge-coder` and NOWHERE else. Checked directly:

    git merge-base --is-ancestor 026ae2aa3 main         -> NOT an ancestor
    git merge-base --is-ancestor 026ae2aa3 origin/main  -> NOT an ancestor
    git merge-base --is-ancestor 026ae2aa3 207dc0c03b   -> NOT on the QA line

So the parcel that reached QA came down a line that never picked it up. QA's
7/8 is exactly what that line contains; this branch has been 8/8 the whole
time. Nobody needed to write the handler — it needed to travel.

This commit carries it forward. The diff from the received commit
(`207dc0c03b`) to this one is the two files above, +282 lines: a real
functional change from the receiver's position, not a no-op re-send.

## Verification, on the merged result

| Command | Result |
|---|---|
| `run_acceptance.sh` on BL-1253's feature | **8 scenarios, 8 pass** |
| `npx vitest run --config vitest.properties.config.mjs test/bl1253TokenOwnershipInvariants.property.test.js` | 4 pass |
| `bb swarmforge/scripts/test/bl1253_stamp_ledger_human_decision_property_runner.bb` | ALL PASS, 400 runs each, non-vacuous coverage |

Invariants 1 and 2 are untouched by this rework and were re-confirmed by QA
itself in the bounce: no hotfix source is modified by this parcel, and the
ledger row for `2ec06b6ef1` still reads `state: stamp-open`,
`human_decision: null`.

## Why this happened, recorded so the shape is visible

The specifier's in-flight amendment (`210677bc4`) added scenario 06 to the
FEATURE FILE, and a separate commit on this branch (`026ae2aa3`) added its
handlers. The feature file travelled with the parcel; the handler commit did
not, because it was never part of a forward — it sat on the branch tip while
the parcel that QA reviewed had already moved on down the chain.

The constitution's amendment protocol covers the spec side (the specifier
notes the holder, the holder merges `main` first). It has no equivalent for
the case where the amendment's IMPLEMENTATION lands on the author's branch
after the parcel has left it: a feature file gains a scenario, its handler is
written, and the two arrive at QA by different routes — or, as here, one of
them does not arrive at all. Not proposing a rule from a single instance;
recording it because the failure was silent on both ends. Every downstream
evidence file honestly reported "7/7" — the number was right for the tree each
role had.
