# BL-1162 QA bounce rematch — 20260826

**Commit checked:** `9b0713def` (merge documenter `8d84c28839` after cleaner re-cut)
**Task:** `BL-1162-start-stop-swarm-cron-lifecycle-symmetry`
**Routing:** `architect`

## Gates PASS (BL-1162 surface)

| Gate | Result |
|------|--------|
| Sibling deferral | VERIFY BL-1162 |
| `test_bl1162_start_stop_swarm_cron_lifecycle.sh` | ALL CHECKS PASSED |
| `bl1162_swarmforge_cron_property_runner.sh` | ALL CHECKS PASSED (13 checks) |
| Acceptance `BL-1162-start-stop-swarm-cron-lifecycle-symmetry.feature` | 4/4 pass |
| Cleaner re-cut `472f1fae1c` purity vs `origin/main` | **PASS** — 16 BL-1162 paths only; `rg '653|660|588|1160|1152'` empty |
| `required_wiring` | PASS |

## Gates FAIL

| Gate | Result |
|------|--------|
| Tip purity vs `origin/main` at documenter tip (BL-506) | **FAIL** — D1 |

## Defects

**D1 — behavior (blame: architect):** Architect merge `916dec860` re-absorbed cleaner re-cut `472f1fae1c` into polluted documenter lineage — 119 files / 52 non-backlog paths reintroduced vs the clean recut, including `operator_enqueue_event.bb`, `swarmShiftCore.ts`, BL-653/660 features and steps.

- **Failing command:** `git diff --name-only origin/main..8d84c28839 | rg '653|660|588|1160|1152|operator_enqueue|swarmShift' | wc -l`
- **Commit hash:** `9b0713def`
- **First error excerpt:** 67 hitchhiker path matches at documenter tip; `472f1fae1c` had zero — pollution restored at architect `916dec860` ("merge cleaner recut 472f1fae1c for BL-1162 rematch review").
- **Failure class:** behavior
- **Expected vs observed:** Expected re-cut tip to remain BL-1162-only through architect→hardender→documenter→QA. Observed architect merge folded recut back into stacked BL-653/660/588/1152 branch — same D1 class as prior bounce, remediation not held through rematch chain.

**Remediation:** Forward BL-1162 from `472f1fae1c` (or hardener rematch `f8d3040cd` if architect pass is doc-only) as additive merge onto `origin/main` — never merge recut into polluted documenter/architect branch. Architect pass must verify `git diff origin/main..HEAD` has no sibling hitchhikers before forwarding.

## Inventory

D1 (architect). Earliest blamed role: **architect**.

By QA.
