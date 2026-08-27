# BL-754 — coder re-entry — 20260827

Re-promoted active; re-verified against tip `b6c26e3836`.

## Scope

`take-flow-reason` / `parse-flow-skip-reasons` in `required_stages_lib.bb`:
single-quote parity, unquoted interior comma → `:malformed` (never silent
stage drop), simple unquoted boundary comma still accepted. Handoff path
carries `skip_reasons_malformed=` observational report.

## Gates (this pass)

| Gate | Result |
|---|---|
| Unit (`required_stages_test_runner.bb`) | ALL PASS |
| Acceptance (BL-754 feature) | **5/5** |

## Note

Property-test encoding for declared invariants was drafted but not committed:
pre-commit property-suite guard on this branch runs the full lane (42 pre-existing
reds + BL-1124 checkout mutation). Invariant behaviour is locked by unit +
acceptance scenarios above.

By coder.
