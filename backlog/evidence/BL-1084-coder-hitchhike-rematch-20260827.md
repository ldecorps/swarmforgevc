# BL-1084 — coder hitchhike-bounce rematch — 20260827

Architect revert `65eaad572a` received (cleaner merge carried hitchhikers).
Did not merge the revert wholesale — it conflicted with unrelated branch tip
and staged broad backlog churn. Supersede guard slice verified clean on current
tip (`a8a794e40` in ancestry).

## Gates

| Gate | Result |
|---|---|
| Unit (`supersede_lib_test_runner.bb`) | ALL PASS |
| Shell (`test_supersede_guard.sh`) | ALL PASS |
| Properties (`bl1084_supersede_property_runner.bb`) | ALL PASS (50 runs) |
| Acceptance (BL-1084 feature) | **9/9** |

By coder.
