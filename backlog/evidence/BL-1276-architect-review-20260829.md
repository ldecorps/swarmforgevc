# BL-1276 — architect review

Architect, 2026-08-29. BL-1276's amended work (widened from `acceptance:`
alone to a `declared-exempt-paths` accessor covering both `acceptance:` and
`retires:`) arrived merged together with BL-1062's in cleaner's commit
`97c45ff0fb`, already present in this worktree via the BL-1062 merge
(architect commit `504aca3ebc`). This commit records the review separately
so the task/commit coherence gate has a BL-1276-attributed commit to send.

## Verified

- `bb swarmforge/scripts/test/task_scope_gate_lib_test_runner.bb` — ALL PASS.
- `bb swarmforge/scripts/test/task_scope_gate_acceptance_exemption_property_runner.bb`
  — ALL PASS, including the widened P1 exactness draws over both `:acceptance`
  and `:retires`, each with an asserted reach floor (>80/200).
- `node specs/pipeline/cli.js specs/features/BL-1276-a-tickets-own-declared-paths-are-not-foreign.feature`
  — 8/8.
- `node specs/pipeline/cli.js specs/features/BL-1192-pre-handoff-task-scope-gate.feature`
  — 9/9, unregressed (constraint).
- `declared-exempt-paths` (required_wiring anchor) present at
  `task_scope_gate_lib.bb:176`; `foreign-scope-findings` keeps its old
  two-arity shape and now also accepts a collection.
- Prose landed: `swarmforge/backlog-schema.md` documents the new `retires:`
  field; `swarmforge/handoff-protocol.md` carries the fourth exemption
  bullet under "Mechanics (`task_scope_gate_lib.bb`)".
- No bypass/env var/override flag introduced.

Architecturally compliant. Forwarding to hardener.
