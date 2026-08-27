# BL-782 — architect rematch pass — 20260826

**Tip:** cleaner rematch `12277ddd41` (QA bounce tip lineage `4210875e49` / coder `51919acd64`)
**Handoff:** `00_20260826T014048Z_000875_from_cleaner_to_architect`
**Prior bounce:** `backlog/evidence/BL-782-qa-bounce-20260826.md` (D1 coder, D2 hardener)

## Verdict

**Pass** — forward to hardender. Review inventory: NONE (architecture).

## Prior bounce clearance

| Item | Status |
|------|--------|
| D1 unreaped decoy hang | **CLEARED** — module `liveDecoys`, `child.unref()`, `afterEach` reap in `bl782ExpediteLivenessScopeSteps.js` |
| D2 mutation caches hitchhiking | **CLEARED vs `origin/main`** on this tip (`mutations/` / `base/` / `build/acceptance-mutation-*` absent). Hardener still owns keeping caches out of later stages. |

## Architecture

- Rematch is test-harness lifecycle only; production probe scoping unchanged
  (root-scoped `pids-matching` needles; operator via `operator.prompt`).
- Acceptance still drives real `expedite_cli.bb` / shell suites — no JS
  reimplementation of process-table matching.
- Module-scoped decoy registry + unref is correct for outline scenarios where
  per-ctx reap cannot see prior-row children (QA D1 root cause).

## Invariants

Declared invariant still encoded in `bl782LivenessProbesScopedToRoot.property.test.js`
(2/2 via `node --test`).

## Scope / tip purity

Authorize **BL-782 paths only**. Cleaner merge also carried pack/telemetry/
backlog renames unrelated to BL-782 — QA stages per BL-506; do not fold
hitchhikers into the land tip.

## Verification

| Check | Result |
|-------|--------|
| `dependency-gate.js` on step handler | PASSED |
| `node --test bl782LivenessProbesScopedToRoot.property.test.js` | 2/2 |
| Ancestry `12277ddd41` ⊂ HEAD | OK |
| Mutation caches vs `origin/main` | none |

By architect.
