# BL-782 hardener rematch — decoy lifecycle + tip purity — 20260826

**Architect tip:** `6fad30f8b6`
**Task:** `BL-782-liveness-probes-scan-whole-process-table`
**Also in batch:** QA merge-up `018fc98cd2` (BL-1147+733+735+737) — sync only

## Prior bounce clearance

| Item | Status |
|------|--------|
| D1 unreaped decoy hang | **CLEARED** — APS 8/8 exits 0 in ~14s (`timeout 90`); no leftover `sleep 600` |
| D2 mutation caches hitchhiking | **CLEARED** — `origin/main...HEAD` has 0 paths under `mutations/`, `base/`, `build/acceptance*` |

## Gates

| Gate | Result |
|------|--------|
| `bl782LivenessProbesScopedToRoot.property.test.js` | 2/2 |
| APS BL-782 acceptance | 8/8 + process exits |
| Surgical `bl782_liveness_probe_mutation_sweep.sh` | killed=3 survived=0 skipped=0 |
| BL-149 cooldown | `skip-cooldown` on expedite_cli.bb |

## Tip purity

Authorize BL-782 rematch paths only; mutation caches not staged.

By hardender.
