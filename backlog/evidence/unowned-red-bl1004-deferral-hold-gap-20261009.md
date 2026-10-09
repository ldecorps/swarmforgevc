# Unowned red: `bl1004_seat_affinity_property_runner.bb` fails its own hold ⟺ ∃seat-:defer equivalence

Found while running adjacent bb test runners as part of BL-2095's own
verification (seat_affinity_lib.bb is untouched by BL-2095; this is
pre-existing on main).

## Repro

```
bb swarmforge/scripts/test/bl1004_seat_affinity_property_runner.bb
```

Fails consistently (3/3 runs, unseeded random draws each time) on its
second sweep ("hold draw ..."), e.g.:

```
hold draw 347: deferral-hold? false but ∃seat-:defer true for {:type "rule_proposal", :task "T-9", :seat-worked-task-sets [...], ...}
```

## Root cause (read at report time, not fixed)

`seat_affinity_lib.bb`'s `deferral-hold?` restricts its rework-candidate
branch to `(= type "git_handoff")` only. `rework-claim-decision` (the
oracle the property runner replays per-seat to compute the expected hold)
has no type restriction at all in `rework-candidate?` - it defers for ANY
type whose `:task` matches a sibling's worked task, not just git_handoff
(and, per its own docstring, intends to also cover `type: "note"` since
BL-1843 - "a note that names a ticket ... is deferred exactly as a
git_handoff for that ticket would be" - but the code enforces no type
check whatsoever, wider even than the docstring's own stated intent).

`deferral-hold?` was never widened to match. The property runner's
second sweep deliberately draws `:non-handoff` shapes with
`:type` in `["note" "awake" "rule_proposal"]` and a real-looking `:task`,
exposing the mismatch.

Likely benign in the live system today: `claim-task-name` (the only
production resolver of a handoff's `:task`) returns a value for a
`git_handoff`'s `task:` header or a `note`'s own `Work BL-…` message, and
nothing for `awake`/`rule_proposal` - so an `awake`/`rule_proposal` never
carries a resolved task in real wiring, and `rework-candidate?`'s own
blank-task guard would short-circuit before the type gap could matter.
Whether that also means `deferral-hold?` should widen to cover `note` the
way `rework-claim-decision` does, or whether `rework-claim-decision` itself
needs a type guard added to match its own docstring's "git_handoff OR
note" intent, is the specifier's call, not read here.

## Why this is out of scope for BL-2095

BL-2095 touches `ready_for_next_task.bb`'s claim-path partition and
`seat_difficulty_lib.bb` (BL-1001's tier filter) only. `seat_affinity_lib.bb`
(BL-1004's own rework-affinity module) is untouched by this parcel's
diff. No open ticket under `backlog/active` or `backlog/paused` names
this file or `deferral-hold?`.
