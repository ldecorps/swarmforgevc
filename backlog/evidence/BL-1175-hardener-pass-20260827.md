# BL-1175 — hardener pass — 20260827

## Inbound

Tip-pure content `295215427` (architect `007154cb2b`). Soft Gherkin
inapplicable (plain Scenarios only — BL-638). No Scenario Outline → no
KNOWN_VALUES pins required in `bl1175PropertySuiteStandingRedsSteps.js`.

## Host / cooldown

| File | Decision |
|---|---|
| `check_property_suite_drift.sh` | **skip-cooldown** (fresh) |
| `property_suite_standing_allowlist_lib.sh` | **run** |

## Gates

| Gate | Result |
|---|---|
| Properties `bl1175PropertySuiteStandingRedsInvariants.property.test.js` | **3/3** |
| Unit `test_property_suite_drift_guard.sh` | **14/14** |
| Acceptance BL-1175 feature | **4/4** |
| Soft Gherkin | **inapplicable** (exit 2) |
| Surgical `bl1175_property_suite_standing_reds_mutation_sweep.sh` | **7/7 killed, 0 survived, 0 skipped** |

## Hardening

- Unit case 14 + property ext-prefix case: `FAIL  extension/test/<allowlisted>`
  must still allow after `ps_allowlist_normalize_file` strips `extension/`.
- Hand-authored surgical over allowlist lib + drift guard (BL-638).

## Forward

`git_handoff` to `documenter`, priority `00`, task
`BL-1175-property-suite-standing-reds-block-unrelated-commits`.

By hardender.
