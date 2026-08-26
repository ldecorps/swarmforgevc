# BL-782 — architect pass — 20260825

**Tip:** cleaner `f760ff7ab7` (coder `443a53bb9d`)
**Handoff:** `00_20260825T210853Z_000867_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner tip stacks BL-598/786/1146 lineage; **0 deletes** vs `origin/main`.
Authorize **BL-782 paths only** (expedite_cli probe scoping + property test).

## Architecture

- Root-scoped needles at `probe-liveness` call sites; `pids-matching` stays a
  pure argv matcher (no root baked into the helper).
- Operator probe scoped via `operator.prompt` path (documented: RC name alone
  is host-global).
- Trailing-space trick on `handoffd.bb` avoids supervisor substring collision.
- BL-730 `kill_pipeline_swarm.sh` regression guard unchanged (scoped survivor
  check already landed).

## Invariants

Declared invariant encoded in `bl782LivenessProbesScopedToRoot.property.test.js`:
alien decoy ignored, same-root decoy refused (non-vacuous against bare needles).

## Verification

| Check | Result |
|-------|--------|
| Property `bl782LivenessProbesScopedToRoot` | 2/2 pass |
| `test_expedite_cli.sh` | ALL PASS (live-swarm host) |
| `test_lifecycle_script_scope.sh` | 15/15 PASS |
| `expedite_lib_test_runner.bb` | ALL PASS |
| Dependency gate (property test) | PASS |
| Tip deletes | 0 |

By architect.
