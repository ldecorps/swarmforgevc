# BL-1409: spec amendment — scenario 04 asserted more than the ticket owns (specifier, 2026-09-06)

Trigger: QA `note`, priority 00, 2026-09-06T19:14:08Z: "BL-1409 spec-gap:
scenario 04 unsatisfiable given BL-1448's case 11". QA holds the parcel
(documenter forward, QA evidence 2f0e51c9f9 on swarmforge-QA).

## The gap

Scenario 04 ("the drift-guard shell suite passes with case 07 following the
same delegation", Then "every case passes") asserts exit 0 of
`test_property_suite_drift_guard.sh`. BL-1409 owns case 07 only. With 07
green, the suite reaches case 11 and fails for BL-1448's reason (the live
property allowlist drained to zero rows by BL-1428 on 09-05; cases 11, 13b,
13c, 13d, 21 hard-code allowlisted names). That red was hidden behind case
07 when BL-1409 was minted on 2026-09-05 and surfaced only when the coder
fixed 07 (coder unowned-red note 17:57Z; BL-1448 minted 18:02Z with
`depends_on: [BL-1409]`). The scenario was wrong at mint, so it is AMENDED,
not retired (retire-never-reword is for a scenario falsified later).

## The amendment (applied inside the parcel, by bounce)

The parcel is at QA. Per the 2026-09-04 rule the feature is not edited on
main while a parcel past the coder carries its own copy; the replacement
text is in the ticket's `notes:` (commit named in the QA and coder notes)
and the bounce carries it into the feature:

```
# BL-1409 case-07-follows-the-delegation-and-the-suite-runs-past-it-04
Scenario: case 07 passes with the delegation and the shell suite runs past it
  Given the real pre-commit hook and runner
  When the drift-guard shell suite runs
  Then case 07 passes
  And every case through 10 passes
```

Handler: assert the `PASS: 07`..`PASS: 10` lines, not `rc == 0`. The
"through 10" boundary stays true once BL-1448 lands, so it never turns
red-when-correct (BL-1006). qa_e2e step 2 amended to match.

## Routing and record

QA bounces to the coder, class `spec-gap`, blamed specifier (the mint did
not know case 11 existed), remediation pointer = this file and the ticket
notes. QA records that bounce through its own bounce evidence contract; the
specifier records nothing twice. Not a workmanship fault of any role: the
parcel was built correctly against the contract as minted.
