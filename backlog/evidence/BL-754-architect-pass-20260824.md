# BL-754 — architect pass — 20260824

## Review inventory (Article 4.4)

NONE.

## Inbound

Merged cleaner `20d0ed5020` (on coder `8a8e86d391`) into
`swarmforge-architect`. Ancestry confirmed.

## Scope

`stage_skip_reasons` flow parse: quote-style parity; unquoted comma inside
a reason → `:malformed` (carried on routing-skip record), never a silent
partial map. Simple unquoted reasons still OK. Reading never blocks the
handoff. Cleaner: shared quoted-reason + flow-ok/malformed helpers.

## Architecture

- Matches approval recommendation (surface remainder like
  `resolve-effective`; do not throw).
- Invariant 1: malformed never presented as complete.
- Invariant 2: single- vs double-quote → same reasons.
- Invariant 3: observational — send still delivers.
- Return shape `{ :reasons :malformed }` is an intentional API change
  with swarm_handoff call sites updated.

## Gates

| Gate | Result |
|---|---|
| Unit (`required_stages_test_runner.bb`) | ALL PASS |
| Acceptance (BL-754 feature) | **5/5** |
| Stamp-off (BL-1113) | **9/9** |
| Dep-gate | N/A (babashka/APS) |

## Findings

NONE.

## Forward

`git_handoff` to `hardender`, priority `00`, task
`BL-754-bl661-unquoted-flow-reason-silently-mis-parses-and-drops-stages`.

By architect.
