# BL-782 hardener pass — liveness probes scoped to root — 20260825 (rematch)

**Architect tip:** `16cf956506`
**Task:** `BL-782-liveness-probes-scan-whole-process-table`
**Merge:** union with prior hardender lineage (BL-731 multiworktree unit tests retained)

## Merge reconciliation

Architect path (acceptance handlers + `--probe-liveness`) merged with hardender
lineage (BL-731 `multiworktreeAcceptanceFixture` unit tests + `node:test`
imports). Evidence files took architect lineage; test union kept both sides'
BL-731 surgical tests and architect BL-782 acceptance wiring.

## Gates

| Gate | Result |
|------|--------|
| `bl782LivenessProbesScopedToRoot.property.test.js` | 2/2 |
| `multiworktreeAcceptanceFixture.test.js` | 9/9 (union) |
| `test_expedite_cli.sh` | ALL PASS |
| APS BL-782 acceptance | 8/8 |
| Gherkin mutation (soft) | total=10 killed=10 survived=0 errors=0 |
| Surgical `bl782_liveness_probe_mutation_sweep.sh` | killed=3 survived=0 skipped=0 |
| BL-149 cooldown | `skip-cooldown` on expedite_cli.bb |

By hardender.
