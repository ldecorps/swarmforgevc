# BL-1175 — hardener pass — cleaner rematch — 20260827

## Inbound

Architect `e5c601cfcd` after cleaner `ec936ef7d` rematch. Tip-pure delta vs
`main`: standing allowlist extended (+6 entries, −2 retired greens on main).

## Host / cooldown

| File | Decision |
|---|---|
| `check_property_suite_drift.sh` | **skip-cooldown** |
| `property_suite_standing_allowlist_lib.sh` | **skip-cooldown** |

No production shell changes this pass — surgical mutation not re-run (prior
pass 7/7 killed on libs; allowlist TSV only).

## Gates

| Gate | Result |
|---|---|
| `test_property_suite_drift_guard.sh` | **14/14** |
| Properties `bl1175PropertySuiteStandingRedsInvariants.property.test.js` | **3/3** |
| Acceptance BL-1175 feature | **4/4** |
| Soft Gherkin | **inapplicable** (exit 2; plain Scenarios only — BL-638) |

## Allowlist inventory

27 standing-red rows in `property_suite_standing_allowlist.tsv` (all
`allowlist` disposition; no silent reds).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1175-property-suite-standing-reds-block-unrelated-commits`.

By hardender.
