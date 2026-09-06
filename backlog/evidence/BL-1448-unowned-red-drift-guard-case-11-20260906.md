# BL-1448: unowned red — test_property_suite_drift_guard.sh case 11 (specifier, 2026-09-06)

Trigger: coder `note`, priority 00, 2026-09-06T17:57:22Z, from the BL-1409
parcel: "unowned-red test_property_suite_drift_guard.sh case 11 fails on
main HEAD". Handled under the standing-red rule (2026-09-05).

## Reproduction

On main at 0ddebf8da9 the suite stops at case 07 (BL-1409's red since
76dd67b692, 2026-08-30):

```
FAIL: 07: pre-commit must invoke check_property_suite_drift.sh (non-comment)
```

With that one assertion neutralized in a scratch copy (SCRIPT_DIR pinned
to the live test dir), and independently from the coder's worktree where
case 07 is already fixed:

```
PASS: 10: SWARMFORGE_SKIP_PROPERTY_SUITE_GUARD remains recovery-only (distinct marker)
FAIL: 11: all-allowlisted reds must allow, got 1: property-suite-guard: run
 FAIL  test/bl632CommitTimeGuardInvariants.property.test.js > x
property-suite-guard: test/bl632CommitTimeGuardInvariants.property.test.js still fails when run alone
Commit rejected: property suite failed with non-allowlisted files:
test/bl632CommitTimeGuardInvariants.property.test.js
```

## Mechanism

The suite's allowlist cases (11, 12, 13, 13b, 13c, 13d, 21) invoke the
LIVE guard, which resolves its allowlist relative to its own directory
(`ps_allowlist_tsv_path "$SCRIPT_DIR"`): the live
`property_suite_standing_allowlist.tsv`. The fixtures name files that were
rows there on 2026-08-27. BL-1428 (7a34298555, 2026-09-05) removed 25
rows when it made the standing-red register authoritative, and every owner
landed that day; the live file now holds only its header. The guard treats
the fixture's "allowlisted" red as non-allowlisted, re-runs it alone
(BL-1407), and refuses. The same shape as BL-1398 (hand list vs a
growing chain), BL-1445 (an inherited env var) and BL-1408: a test asserting
against live, moving data instead of its fixture.

## Disposition

- BL-1448 (new, `type: defect`, `severity: high`, epic code-quality-gates,
  `depends_on: [BL-1409]`): the fixture owns its allowlist through the
  guard copy it already installs for case 07.
- BL-1409 (active, coder): owns case 07 but had NO register row and sat
  at `medium` - both corrected this pass (row first_seen 2026-08-30;
  severity high). Bookkeeping only; the coder was told.
- Register: two rows for the one file, one per owner and case; each
  owner's landing removes its own row.
