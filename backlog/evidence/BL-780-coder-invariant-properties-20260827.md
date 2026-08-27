# BL-780 — coder rematch — invariant property encoding — 20260827

Architect bounce D1/D2: declared invariants lacked generative encoding.

## D1 — encoded
`swarmforge/scripts/test/bl780_rotation_actionability_ordering_property_runner.bb`
fuzzes (note, starve, warn) triples: sound → empty warnings; inverted note →
non-empty warning naming both values. Non-vacuous probe against a silent
broken path included.

## D2 — stated non-encodability
"At most one drain per sweep with ROTATE_HOME between drains" quantifies over
mailbox + chase-sweep process state (tmux/role queues), not a pure module.
Acceptance APS already pins the five-role merge-up fixture. No pure
multi-role drain predicate exists to fuzz without reimplementing handoffd's
IO; encoding would be vacuous prose. Acceptance remains the executable
guard for BL-576 drain cadence at the shipped note_actionable_after_ms.

By coder.
