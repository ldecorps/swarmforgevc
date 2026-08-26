# BL-1162 QA bounce rematch2 — 20260826

**Commit checked:** `c29411e42` (merge documenter `e2a0da8042`)
**Task:** `BL-1162-start-stop-swarm-cron-lifecycle-symmetry`
**Routing:** `hardender`

## Gates PASS (BL-1162 surface)

| Gate | Result |
|------|--------|
| Sibling deferral | VERIFY BL-1162 |
| `test_bl1162_start_stop_swarm_cron_lifecycle.sh` | ALL CHECKS PASSED |
| `bl1162_swarmforge_cron_property_runner.sh` | ALL CHECKS PASSED |
| Acceptance (4 scenarios) | 4/4 pass |
| Architect clean re-forward `89545ab60` vs `origin/main` | **PASS** — 17 BL-1162 paths; zero code hitchhikers |
| `required_wiring` | PASS |

## Gates FAIL

| Gate | Result |
|------|--------|
| Tip purity at documenter tip (BL-506) | **FAIL** — D1 |

## Defects

**D1 — behavior (blame: hardener):** Hardener `merge_and_process architect 89545ab60` re-absorbed clean architect tip into polluted hardener branch — `operator_enqueue_event.bb`, BL-653/660 steps, and 70 sibling path matches restored at documenter tip `e2a0da8042`.

- **Failing command:** `git diff --name-only origin/main..e2a0da8042 | rg '653|660|588|1160|1152|operator_enqueue|swarmShift|apply_shift' | wc -l`
- **Commit hash:** `c29411e42`
- **First error excerpt:** architect `89545ab60` had 0 hitchhiker code paths; hardener `e3a6035ba` restored full stacked diff including `swarmforge/scripts/operator_enqueue_event.bb`, `specs/pipeline/steps/bl653OperatorEscalationDrivenSteps.js`.
- **Failure class:** behavior
- **Expected vs observed:** Expected architect rematch2 clean re-forward to survive hardener→documenter→QA. Observed hardener merge_and_process re-polluted tip (D2 bounce class, blame shifts from architect to hardener).

**Remediation:** Hardener forward from detached `89545ab60` additively — cherry-pick hardening only; never merge_and_process clean architect tip into polluted hardener branch. Verify `git diff origin/main..HEAD` has zero sibling hitchhikers before forwarding.

## Inventory

D1 (hardener).

By QA.
