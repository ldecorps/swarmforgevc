# BL-1122 coder rematch — encode declared invariants as property runner

## Bounce addressed
Architect D1 (`9734c4f3ec`): three YAML invariants had no property encoding.

## Change
- `swarmforge/scripts/test/bl1122_mid_commit_mute_property_runner.bb`
  - I1: durable `:staged-for-reversion` with `in-flight?` false → alarms via
    `check-master-checkout-drift!` + injected `emit-alarm!`
  - I2: `commit-in-flight?` / mute path read-only (lock observe; no leftover `.git` files)
  - I3: after in-flight clears, same staged shape alarms again (not sticky)
  - Control: staged-only while in-flight mutes; `:uncommitted-edit` still alarms in-flight

Stacked on cleaner tip lineage (`maybe-emit-alarm!`) + bounce evidence.

## Verification
- `bb …/bl1122_mid_commit_mute_property_runner.bb` → ALL PROPERTIES HOLD
- APS BL-1122 → 5/5
- `master_checkout_drift_lib_test_runner.bb` → ALL PASSED
- `test_handoffd_master_checkout_drift_wiring.sh` → ALL PASSED
