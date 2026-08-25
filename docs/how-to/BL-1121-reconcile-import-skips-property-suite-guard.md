# Reconcile import skips the property-suite guard (BL-1121)

Importing already-QA'd `origin/main` into local `main` (BL-891 reconcile /
human merge) stages extension paths that are often byte-identical to the
incoming parent. The pre-commit property-suite guard used to run the full
~150s suite on that import, making joins unwinnable under handoffd's tick.
`SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` was the only escape — recovery-only,
not a standing recipe.

## Standing skip

When the checkout is mid-merge and every suite-trigger staged path
(`extension/src/*`, `*.property.test.js`) matches the incoming merge parent
byte-for-byte, `check_property_suite_drift.sh` prints
`property-suite-guard: skip-reconcile-import` and exits 0 **without** running
the suite and **without** the env override.

Parent resolution is shared via `incoming_merge_parent_lib.sh` (same contract
as the pipeline-on-main guard / BL-925 lineage).

## What still runs

| Situation | Guard |
| --- | --- |
| Ordinary non-merge `extension/src` edit | `property-suite-guard: run` |
| Mid-merge byte-identical import | `skip-reconcile-import` |
| `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` | `overridden` (recovery-only) |

## Related

- [BL-570 property-suite drift guard](BL-570-property-suite-drift-guard.md)
- [BL-1120 foreign merge abort skip](BL-1120-handoffd-must-not-abort-foreign-merge.md)
- [BL-1124 fixtures must not mutate shared main](BL-1124-property-suite-fixtures-must-not-mutate-shared-main.md)

Acceptance:
`specs/features/BL-1121-reconcile-import-skips-property-suite-guard.feature`
