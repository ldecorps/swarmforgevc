# BL-1095 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `43931d7fe7` (on coder `a600d4307d`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

`expedited-types` → `#{"defect"}` only; transition docstring removed.
Mint hygiene refuses `type: bug` (`:retired-ticket-type`). Legacy
bug-is-expedited unit/property rows deleted (not inverted). Audit + gate
banner name the new kind. Open corpus still has zero promotable `type: bug`.

## Architecture

- Invariant 1: predicate drop and mint refuse landed together.
- Invariant 2 (boot article vs predicate): Article 3.2.4 Transition bullet
  remains on disk by design — ticket notes assign that trim to the
  specifier under BL-798 (cannot be scheduled via `required_stages`). Code
  half matches approval; prose discharge is out of this tip's scope.
- Vacuous "done tickets still need bug" justification removed from the
  predicate docstring (structural vacuity named in the ticket).

## Gates

| Gate | Result |
|---|---|
| Unit (`promotion_gates_lib_test_runner.bb`) | ALL PASS |
| Properties (`promotion_gates_lib_property_runner.bb`) | ALL HOLD |
| Unit (`backlog_hygiene_lib_test_runner.bb`) | all passed |
| Acceptance (BL-1095) | **9/9** |
| Stamp-off (BL-1113) | **9/9** |

## Findings

NONE for the pipeline parcel. Specifier still owes the Article 3.2.4
Transition trim + `boot_prefix_budget_gate.sh` (ticket notes).

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-1095-retire-the-expedite-lanes-legacy-bug-type`.

By architect.
