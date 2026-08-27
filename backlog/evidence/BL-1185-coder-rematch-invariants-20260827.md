# BL-1185 — coder rematch (architect bounce) — 20260827

## Bounce

Architect `3d87b1e81` / tip `57d6f1a12a`: D1 invariant-unencoded — three
declared invariants lacked property encoding (BL-633 / BL-654). Functional
wiring + APS 4/4 were green; tip purity OK.

## Remediation

Added `extension/test/bl1185WorkNoteMissingTaskHeader.property.test.js`:

| Prop | Invariant |
|------|-----------|
| P1 | Work BL-… notes resolve task name when `task:` absent |
| P2 | high `mutation_cost` + Work note without `task:` → hard `:claim` (nil cost still `:defer-better-fit`) |
| P3 | Work notes stay `type: note` without `task:`; `swarm_handoff` refuses `task` on notes |

Non-vacuity notes are in the test file header (break-then-fix at authoring).

## Tip purity

Rebuilt on `origin/main` + BL-1185 paths only (ticket, topic, feature, steps,
index, `ready_for_next_task.bb`, property test, evidence). Ancestry merge
records architect bounce tip.

## Checks

- `vitest` properties file: 3/3 pass
- Tip paths: BL-1185-only

By coder.
