# BL-1175 — QA pass (cleaner rematch) — 20260827

## Inbound

Documenter handoff `ce4db2f806` — required_wiring realigned to standing
allowlist TSV. Merged at HEAD.

Prior bounce `926319ccb2` (entangled tip); cleaner rematch `ec936ef7d`
verified allowlist extension (+6 entries).

## Verification inventory

| Gate | Command | Result |
|------|---------|--------|
| Sibling | `qa-sibling-check.js status --ticket BL-1175` | VERIFY |
| Ancestry | `8d01a617e` (coder), `047ac823e` (hardener) ancestors of HEAD | CONFIRMED |
| Compile | `npm run compile` (extension/) | PASS |
| Drift guard | `test_property_suite_drift_guard.sh` (BL-1175 cases 11–13) | **14/14 PASS** |
| Property | `bl1175PropertySuiteStandingRedsInvariants.property.test.js` | **3/3 PASS** |
| Acceptance | `run_acceptance.sh specs/features/BL-1175-property-suite-standing-reds-block-unrelated-commits.feature` | **4/4 PASS** |
| Wiring | `bl1175PropertySuiteStandingRedsSteps` in `index.js`; `property_suite_standing_allowlist.tsv` (27 rows, all `allowlist`); `check_property_suite_drift.sh` BL-1175 path | CONFIRMED |
| Full unit | `npm test` | BLOCKED BY host env — `CURSOR_API_KEY` unset across bridge suites (**BL-720** family; standing debt per BL-728) |
| Full property | `npm run test:properties` | Standing reds all allowlisted (ticket intent); BL-1175 invariants green |

## Intent

Standing property failures named with fix-or-allowlist disposition; unrelated
green commits not refused without SKIP; SKIP remains recovery-only; BL-1124
canary stable on stock runs.

## Inventory (Article 4.4)

NONE.

## Verdict

**PASS** — land via BL-1144; coordinator bookkeep **BL-1175**.

By QA.
