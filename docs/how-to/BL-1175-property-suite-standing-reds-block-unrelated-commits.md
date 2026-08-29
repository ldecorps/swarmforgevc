# Standing property reds do not block unrelated green commits (BL-1175)

*How-to. Task-oriented: land a green parcel when the property suite still
has known standing failures — without using the SKIP override as a habit.*

## The gap

`check_property_suite_drift.sh` (BL-570) refused any commit that staged
`extension/src` or `*.property.test.js` while `npm run test:properties` had
failures — including ~22 pre-existing reds. That stranded an otherwise green
BL-605 tip. `SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD=1` is recovery-only
(BL-1121), not the standing recipe.

## What changed

Standing failures are named in
`swarmforge/scripts/property_suite_standing_allowlist.tsv` with disposition
(`allowlist` / `fix`) and rationale. The guard allows the commit when every
reported failing file is allowlisted; any non-allowlisted failure still
blocks and lists those files.

**BL-1234 fix (2026-08-28):** the guard's own path extractor emitted every
normalized failing-file path onto the same line (a missing newline at its
one call site), so `sort -u` saw the whole set as a single, unmatchable
concatenated string whenever **two or more** files were red — which is the
only case that happens in practice once the allowlist names more than one
file. A single failing file worked (`sort` itself supplied the terminator);
two or more always refused, with a message naming a path that does not
exist. Fixed by emitting one path per line before `sort -u` runs; the
verdict now depends on *which* files failed, never on how many.

| Want | Do |
| --- | --- |
| Land green work while known reds remain | Keep those files on the TSV; do not set SKIP |
| New / unowned suite failure | Fix it, or add a TSV row with rationale — do not silent-red |
| Machinery broken | SKIP once for recovery, then restore the standing path |

Also see the updated tables in
[Pre-commit property-suite drift guard](BL-570-property-suite-drift-guard.md).

## Verify

```bash
bash swarmforge/scripts/test/test_property_suite_drift_guard.sh
cd extension && npm test -- bl1175PropertySuiteStandingRedsInvariants
bash specs/pipeline/scripts/run_acceptance.sh \
  specs/features/BL-1175-property-suite-standing-reds-block-unrelated-commits.feature
```

Related: [BL-1121 reconcile import skip](BL-1121-reconcile-import-skips-property-suite-guard.md),
[BL-1124 shared-repo canary](BL-1124-property-suite-fixtures-must-not-mutate-shared-main.md).
