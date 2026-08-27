# BL-1175 — architect pass — 20260827 (cleaner rematch ec936ef7d)

**Received:** `merge_and_process cleaner ec936ef7d8` (handoff
`00_20260827T165558Z_000035_from_cleaner_to_architect`)
**Merged at:** `e26fa5130` (merge --no-ff)
**Reviewed commit:** `ec936ef7d8`
**Task:** BL-1175-property-suite-standing-reds-block-unrelated-commits

## Verdict

**Pass** — forward to hardender. Inventory NONE.

## Parcel intent

Extend the standing-red allowlist TSV so six newly failing property files are
explicitly allowlisted and two now-green files (`bl759`, `bl968`) are removed.
Unrelated green commits must not be blocked; SKIP remains recovery-only.

## Architecture

Standing property-suite reds stay an explicit TSV inventory consulted by
`check_property_suite_drift.sh` via `property_suite_standing_allowlist_lib.sh`.
Policy (allowlist vs fix disposition) stays in data; the guard shell remains
the adapter. No extension-host/webview boundary crossed; no tmux/process-spawn
concerns in changed paths.

## Checks

| Check | Result |
|-------|--------|
| Tip-pure vs `origin/main` | **3 paths only** (allowlist TSV + evidence) — no hitchhikers |
| Dependency gate | **PASSED** (`bl1175PropertySuiteStandingRedsInvariants`, `bl1175PropertySuiteStandingRedsSteps`) |
| Co-change | Expected BL-1175 slice coupling only — no new boundary defect |
| Declared invariants | **3/3** property tests (`bl1175PropertySuiteStandingRedsInvariants.property.test.js`) — non-vacuous |
| Property pass (undeclared) | **N/A** — parcel touches allowlist data only; no new pure-module invariants |
| Drift guard shell | **13/13** (`test_property_suite_drift_guard.sh`) |
| APS | **4/4** (`BL-1175-property-suite-standing-reds-block-unrelated-commits.feature`) |
| Ancestry `ec936ef7d8` → tip | OK |

## Forward

`git_handoff` → **hardender**, task `BL-1175-property-suite-standing-reds-block-unrelated-commits`.

By architect.
