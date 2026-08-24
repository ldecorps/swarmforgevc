# BL-1001 — architect bounce — 20260824

## Review inventory (Article 4.4)

1. **Undeclared seat on a tier-active stage can claim above-tier work** —
   When any seat declares `--seat-tier`, `stage-tiers-active?` is true, but
   `seat-accepts?` treats a nil tier as accept-all. Probe:

   ```
   me=coder@sonnet2 my-tier=nil cost=high tiers={coder→hard}
   sibling hard busy → :claim
   ```

   That is exactly the spill-down the operator forbade (invariant 1 /
   approval: hard work never lands on the cheap seat however idle it is).
   A second window re-added without `--seat-tier easy` would silently
   re-create the false economy. Durable fix: on a tier-active stage, a
   seat with no declared tier must `:skip-ineligible` (declaration is
   mandatory to participate — matches invariant 2: tier is DECLARED,
   never inferred/defaulted open). Lock with a unit + property before
   green.

## Inbound

Merged cleaner `2e5fdcac1d` (on coder `a1eb4867ce`) into
`swarmforge-architect`. Ancestry confirmed.

## What is otherwise sound

- Pure `difficulty-claim-decision` + filter in front of BL-983 claim path
  (not a new delivery mechanism).
- Declared two-seat world: asymmetric wait / spill-up / prefer-fit /
  exchange-of-declarations — unit, 3/3 properties, **6/6** Gherkin green.
- Pack currently has a single coder seat with `--seat-tier hard` (sonnet2
  removed by operator comment); that topology alone is fine. The hole is
  the mixed declared/undeclared stage.

## Gates (pre-bounce)

| Gate | Result |
|---|---|
| Unit (`seat_difficulty_lib_test_runner.bb`) | ALL PASS |
| Properties | **3/3** |
| Acceptance (BL-1001) | **6/6** |
| Stamp-off (BL-1113) | **9/9** |

## Forward

`git_handoff` to `cleaner`, priority `00`, task
`BL-1001-difficulty-aware-coder-seat-routing` (bounce — close inventory
item 1, then return).

By architect.
