# BL-1084 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `554b957f98` (on coder `a8a794e409`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

Durable `.swarmforge/superseded/<task>` markers + `enforce-supersede-guard!`
in `ready_for_next.bb` before task/batch dispatch (beside BL-640). Pure
`supersede_lib` decide; callers do IO. Cleaner: named refuse helpers.

## Architecture

- Matches approval: plain operator-deletable store; one shared turn-start
  entry point — get-it-wrong risk contained by invariant 2.
- Invariant 1: stage-independent (any role / pack that uses ready_for_next).
- Invariant 2: absent → pass; unreadable → refuse (never empty).
- Required wiring: function name contains `supersede`; called from
  `ready_for_next.bb` before dispatch.
- Refusal leaves parcel in place; not a bounce. Specifier note still the
  fast path; marker is the backstop for forwarded copies.

## Gates

| Gate | Result |
|---|---|
| Unit (`supersede_lib_test_runner.bb`) | ALL PASS |
| Properties (`bl1084_supersede_property_runner.bb`) | ALL HOLD (500) |
| Shell (`test_supersede_guard.sh`) | ALL PASS |
| Acceptance (BL-1084 feature) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/shell/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1084-a-superseded-task-stops-at-every-stage`.

By architect.
