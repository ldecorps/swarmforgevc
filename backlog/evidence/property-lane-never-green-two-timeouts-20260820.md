# Property lane is never green: bl868 + bl632 time out — QA's claim VERIFIED

Raised by: QA (note 20260820T040425Z_000392, priority 20, "Standing: property lane never
green - bl868+bl632 time out; needs a ticket").
Coordinator verified against QA's own run log (`.worktrees/QA/tmp/qa-props-910.log`,
the completed 2163s BL-910 properties run). **Exactly as reported.**

## Measured
    Test Files  2 failed | 115 passed (117)
    Tests       2 failed | 363 passed (365)

    test/bl868PropertyLaneIsolationGuards.property.test.js  (3 tests | 1 failed) 126374ms
      -> Test timed out in 60000ms.
    test/bl632CommitTimeGuardInvariants.property.test.js    (1 test  | 1 failed) 154346ms
      -> Test timed out in 90000ms.

Only two failures in the whole lane, both timeouts, both in the files QA named. Nothing
else is red — so "never green" is precise: the lane is otherwise healthy and these two
gate it permanently.

## Shape: both overshoot by ~1.7-2x, which points at duration, not logic
126s against a 60s budget; 154s against 90s. Neither is a marginal miss, and neither is
an assertion failure — they are wall-clock exhaustions. That is consistent with either
(a) genuinely under-budgeted timeouts for what these properties do, or (b) host-load
inflation. Tonight the host has been running 8 agents plus vitest and mutation work
concurrently, so (b) is live.

Worth flagging for whoever specs this, NOT concluded here: BL-935 landed a vitest
fork-pool cap aimed at exactly this oversubscription, but it keys on `SWARMFORGE_PACK`,
which BL-961 (still in flight, at coder) exists to make the launcher actually export.
The variable currently reaches role shells only via tmux's GLOBAL env from an ad-hoc
operator export — so whether the cap was engaged during this run is not something the
log alone settles. Determining that is part of the ticket, not an assumption to carry in.

## Routing
QA asked for a ticket; minting is the specifier's. Routed there with this evidence.
Not treated as a QA bounce: the failing files belong to no ticket currently in flight,
and this is a standing lane condition rather than a defect in the parcel QA was gating.
