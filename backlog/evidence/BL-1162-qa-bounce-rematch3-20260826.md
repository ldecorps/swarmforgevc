# BL-1162 QA bounce rematch3 — 20260826

**Commit checked:** `6e53948aa` (merge documenter `14cebfb64e`)
**Task:** `BL-1162-start-stop-swarm-cron-lifecycle-symmetry`
**Routing:** `documenter`

## Gates PASS (BL-1162 surface)

| Gate | Result |
|------|--------|
| Sibling deferral | VERIFY BL-1162 |
| Lifecycle shell + property runner | ALL CHECKS PASSED |
| Acceptance (4 scenarios) | 4/4 pass |
| Hardener bounce-fix `cbc92e143` vs `origin/main` | **PASS** — 17 BL-1162 paths; 0 hitchhikers |
| Architect clean `89545ab60` | 0 hitchhikers (confirmed) |
| `required_wiring` | PASS |
| Ticket lineage (`89545ab60` / `cbc92e143` ancestors of parcel) | PASS |

## Gates FAIL

| Gate | Result |
|------|--------|
| Tip purity at documenter tip (BL-506) | **FAIL** — D1 |

## Defects

**D1 — behavior (blame: documenter):** Documenter `merge_and_process` hardener clean tip `cbc92e143` into polluted documenter branch — restored `operator_enqueue_event.bb`, BL-653/660 steps, and 73 sibling hitchhiker matches at tip `14cebfb64e` (50+ files added vs clean `cbc92e143`).

- **Failing command:** `git diff --name-only origin/main..14cebfb64e | rg '653|660|588|1160|1152|operator_enqueue|swarmShift|apply_shift' | wc -l`
- **Commit hash:** `6e53948aa`
- **Failure class:** behavior
- **Expected vs observed:** Expected documenter to forward hardener clean tip additively. Observed documenter merge re-absorbed stacked sibling diff (same class as prior bounces; hardener fixed its stage, documenter re-polluted).

**Remediation:** Forward from detached `cbc92e143` (docs-only delta allowed) onto `origin/main` — never merge_and_process clean tip into polluted documenter lineage. Verify hitchhiker grep empty before QA handoff.

## Inventory

D1 (documenter).

By QA.
