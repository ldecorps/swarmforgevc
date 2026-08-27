# BL-782 hardener pass — liveness probes scoped to root — 20260825

**Architect tip:** `f8fdb2f186` (batch with BL-1146 QA merge-up)
**Task:** `BL-782-liveness-probes-scan-whole-process-table`

## Gates

| Gate | Result |
|------|--------|
| `bl782LivenessProbesScopedToRoot.property.test.js` | 2/2 (fixed missing `test` import) |
| `test_expedite_cli.sh` | ALL PASS |
| Surgical (3) | killed=3 survived=0 |
| BL-149 | `skip-cooldown` on expedite_cli.bb |

By hardender.
