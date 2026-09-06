# property-suite-guard-rerun-ceiling-600s — hardender review pass, 2026-09-06

NONE. The full checklist was run and found no defect.

Recorded as an explicit NONE rather than skipped: an inventory is a pass
artifact, not only a bounce artifact (Article 4.4), and the forward names
THIS commit rather than the received hash (BL-536).

## Detail

A one-line, specifier-directed immediate mitigation (RERUN_CEILING_SECONDS_DEFAULT
180 -> 600), no formal ticket YAML - a hotfix-shaped change. Ran the
guard's own shell suite (`test_property_suite_drift_guard.sh`): 10/11
pass, case 11 fails identically with the exact same failure as the
coder's own documented baseline comparison (BL-1448's pre-existing,
already-registered red, unaffected by this change). Confirmed no other
site hardcodes the old 180 value; the two ceiling-related test cases
(22, 25) exercise the SWARMFORGE_PROPERTY_RERUN_CEILING_SECONDS override
path, not the default, so they are unaffected either way. Ran all 18
whole-tree standing guards (183 tests, clean).

No dedicated test asserts the literal default value (180 vs 600) - not
adding one: that would pin a magic number rather than behavior, and the
existing suite already proves the override mechanism and general
flow correctly at any ceiling.

By hardender.
