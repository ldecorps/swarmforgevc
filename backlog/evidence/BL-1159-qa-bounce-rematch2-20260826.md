# BL-1159 QA bounce (rematch 2) — 20260826

**Commit checked:** `1439d3f55` (Merge documenter `8d8d0f8556`)
**Task:** `BL-1159-bridge-child-survives-without-crash-giveup-loop`
**Routing:** `coder`

## Gates PASS (BL-1159 surface)

| Gate | Result |
|------|--------|
| Acceptance | 4/4 PASS |
| `test_bl1159_bridge_child_survives_without_crash_giveup_loop.sh` | ALL PASS |
| `test_recover_miniapp_bridge.sh` | ALL PASS |
| `test_operator_runtime_tick.sh` | ALL PASS |
| Mutation sweep | 4/4 killed |
| BL-1153 index + residentSpy | **PASS** (restored vs prior bounce) |

## Defects blocking land

**D1 — behavior (blame: coder):** `operator_runtime.bb` calls `operator-lib/tick-observed-events`,
which **does not exist on `origin/main`** (`operator_lib.bb` has 0 matches). The call was bundled
with BL-1159 recover routing in coder `43da3844ec` / cleaner `bab418c421`. Tests pass on QA HEAD
only because polluted `operator_lib.bb` carries BL-653's `tick-observed-events` from sibling
hitchhikers. Landing BL-1159 alone would break operator runtime on `main`.

- **Failing command:** `git show origin/main:swarmforge/scripts/operator_lib.bb | grep tick-observed-events` (empty) AND `git show HEAD:swarmforge/scripts/operator_runtime.bb | grep tick-observed-events` (present)
- **Expected:** BL-1159 changes limited to `recover_miniapp_bridge.sh` wiring; tick observation block unchanged from `origin/main`
- **Observed:** tick block replaced with BL-653 API not on main

**Remediation:** `swarmforge/scripts/operator_runtime.bb` — restore the inline `cond->` observed-events block from `origin/main`; keep only `recover-miniapp-bridge-script` def + `miniapp-bounce-bridge!` routing change.

**D2 — behavior (blame: cleaner):** Land diff still entangled (56+ sibling paths: BL-588/653/660/1160/INTAKE). Documenter `8d8d0f8556` yaml-only (`abandoned_commits` +1 line).

- **Failing command:** `git diff origin/main...HEAD --name-only | grep -E '588|653|660|1160|INTAKE|batchRecovery' | wc -l` → 56
- **Expected:** BL-1159-only tip from `origin/main`
- **Observed:** polluted QA lineage

**Remediation:** Re-cut BL-1159 from `origin/main` after D1 fix; forward clean tree (cleaner tip `bab418c421` paths minus BL-653 tick block).

## Inventory

D1 (coder), D2 (cleaner). Route **coder** on D1 land-breaker.

By QA.
