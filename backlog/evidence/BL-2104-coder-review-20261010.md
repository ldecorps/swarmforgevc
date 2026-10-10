# BL-2104 coder review: hotfixes 304e4a8816 and c045fbbfc3

Reviewed 2026-10-10 on worktree branch swarmforge-coder at 7225405326
(== main == origin/main; both hotfixes are already ancestors of HEAD, so
no merge was needed). Review only - nothing re-applied.

## What was reviewed

1. `c045fbbfc3` (swarmforge/scripts/seat_affinity_lib.bb):
   - adds `(def rework-deferrable-types #{"git_handoff" "note"})` (line 66);
   - `rework-claim-decision`'s rework-candidate? reads the set (line 99);
   - `deferral-hold?`'s rework branch reads the same set (line 149);
   - BL-1655's reclaim branch (held-by-seat non-blank, >1 seat) stays
     type-agnostic in both functions.

2. `304e4a8816` (the two test runners):
   - `bl1004_seat_affinity_property_runner.bb`: the base draw now takes
     `:type` from `(rand-nth* (sort seat-affinity-lib/rework-deferrable-types))`
     so every deferrable type walks the same shapes; the `:non-handoff`
     shape draws only `["awake" "rule_proposal"]` (the never-deferred
     shapes); the first sweep asserts "non-deferrable type decided"
     instead of the pre-BL-1843 "non-git_handoff decided".
   - `seat_affinity_lib_test_runner.bb`: the pre-BL-1843 "a note is never
     held" assertion now reads held (true) for a note naming a
     sibling-worked ticket, and awake/rule_proposal are asserted never
     held (`[false false]`).

## Review question (from the ticket)

Is a type guard on rework-claim-decision the right reading of BL-1843,
rather than dropping the hold's type check outright?

Yes. BL-1843 (541d376bfe) dropped the claim decision's type check
entirely, and its docstring says "a git_handoff OR a note naming a ticket
... is deferred exactly as a git_handoff for that ticket would be" - the
intended deferrable set is exactly {git_handoff, note}. The hotfix
restores the guard as a shared set read by BOTH the claim decision and
deferral-hold?:

- `claim-task-name` (ready_for_next_task.bb:153) resolves a task only
  from a git_handoff's `task:` header or a note's `Work BL-...` message,
  so awake/rule_proposal can never carry a resolvable task in live
  parcels - the guard excludes exactly the shapes no live parcel
  reaches.
- deferral-hold? must mirror the claim decision exactly (its docstring:
  "would at least one seat of its stage defer it right now?"); a shared
  set keeps the two in lockstep, which is what the bl1004
  hold<=>some-seat-defers sweep checks.
- Dropping the hold's type check outright (matching BL-1843's claim side)
  would let deferral-hold? hold an awake/rule_proposal carrying a task,
  which the claim path would never defer - the sweep would mute a real
  stall. The guard is the correct, minimal reading.

Live behaviour is unchanged: claim-task-name gates task resolution to the
same two types; the guard only narrows unreachable shapes.

## Runs (one each, on the parcel commit)

- `bb swarmforge/scripts/test/bl1004_seat_affinity_property_runner.bb`:
  ALL PROPERTIES HOLD (400 draws).
- `bb swarmforge/scripts/test/seat_affinity_lib_test_runner.bb`: all
  assertions passed.
- `bash swarmforge/scripts/test/test_chase_sweep.sh`: ALL PASS (17 cases).
- `bb swarmforge/scripts/test/flow_watchdog_test_runner.bb`: ALL PASS.
- `node specs/pipeline/cli.js` on the BL-1843 feature: 7/7 pass.
- `node specs/pipeline/cli.js` on the BL-1004 feature: 5/5 pass.
