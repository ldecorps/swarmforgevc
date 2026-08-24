# BL-1085 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `1c1be911ad` (on coder `6bd229f6a5`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Push-sweep ahead-range: (1) cache complete refusal gathers keyed on main tip
SHA + ordered ahead-SHA vector; (2) one walk per tick via shared
`ahead-range-facts!` in the adapters map. Incomplete gathers never cached.
Cleaner: thin `resolve-fresh!` / tip-ancestry helpers.

## Architecture

- Matches approval 1+2 as one ticket; does not weaken BL-630/855/952 refuse
  semantics.
- Invariant 1: cache REPLAYS a fully enumerated verdict for an identical
  key — never tip-only inference (BL-952 anti-pattern).
- Invariant 2: tip move, ahead set change/reorder, or incomplete prior
  gather → full re-enumeration.
- Invariant 3: tick memo + both gates reading `:qa-facts` / `:noop-facts`
  from one payload.
- Required wiring: `ahead-range-facts!` defined and passed into `sweep!`
  adapters (shell fixture asserts).

## Gates

| Gate | Result |
|---|---|
| Unit (`push_sweep_ahead_range_lib_test_runner.bb`) | ALL PASSED |
| Properties (`bl1085_ahead_range_property_runner.bb`) | ALL HOLD (500) |
| Shell (`test_push_sweep_ahead_range.sh`) | ALL PASSED |
| Acceptance (BL-1085 feature) | **11/11** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/shell/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1085-push-sweep-re-proves-the-same-refusal-every-cycle`.

By architect.
