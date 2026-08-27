# BL-786 — architect pass — 20260825

**Tip:** cleaner `9388907643` (coder `ce0455216e`)
**Handoff:** `00_20260825T205914Z_000865_from_cleaner_to_architect`

## Verdict

**Pass** — forward to hardender. Review inventory: NONE.

## Scope / tip purity

Cleaner tip stacks BL-1146 lineage; **0 deletes** vs `origin/main`.
Authorize **BL-786 paths only** (mutation concurrency resolver + wiring).

## Architecture

- Root cause: frozen `concurrency` in stryker configs; BL-427 recommender
  existed but no production caller at launch.
- Fix: `resolve-mutation-concurrency.ts` uses `recommendMutationConcurrency`
  + shared `DECLARED_PEAK_RSS_PER_WORKER_BYTES`; `mutation-concurrency.js`
  wraps every mutation npm script; `MUTATION_CONCURRENCY` pin wins; launch
  prints resolution + inputs. Config file constants overridden at runtime via
  `--concurrency` flag injection.

## Verification

| Check | Result |
|-------|--------|
| `resolveMutationConcurrency.property.test.js` | 4/4 pass |
| APS BL-786 feature | 11/11 pass |
| Tip deletes | 0 |

By architect.
