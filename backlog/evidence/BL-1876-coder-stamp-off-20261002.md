# BL-1876 coder stamp-off of hotfixes c7ee0fb192 and 6dad026320 (2026-10-02)

## Review (not re-applied)
Each change matches BL-1830's ruling A (a shared own path is rebuilt from origin/main plus only the
landing ticket's own changes, so no unlanded sibling's lines ride, approved or not):
- BL-1375 06/07 retired (passenger through an inconsistent / consistent replayed tree): both premise
  a passenger riding, which BL-1830 removed. 01's handler now asserts `rebuilt[shared].excluded`
  names the sibling and the sibling is not in `passengers` - the rebuild, observed.
- BL-1465 01/02 retired (a passenger planned through land-plan); 03/04 stand.
- BL-1466 02 retired; scenario 05 keeps its still-valid half (a re-fixed sibling does not block, the
  plan is `replay`, the sibling is not a passenger).
- BL-1389 03 retired (6dad026320).
Each feature's narrative names BL-1876. No scenario was reworded.

## Removed step definitions (none matched any `specs/features/*.feature` step line; no outlines)
- bl1375ApprovedSiblingsCanLandSteps.js: `one sibling's shared-path lines reference a file that is not
  on main`, `every file the shared-path lines reference is on main`, and every `treeShouldBeConsistent`
  branch they fed (decide's replay shim; the tree branches of `a land is available for that ticket`
  and `the land is refused naming that sibling`). `decide` now puts the handler on main
  unconditionally - the path scenario 01-05 already took.
- bl1466BouncedSiblingNeverRidesSteps.js: `the sibling's approval state is approved and it may ride
  as a passenger as before`.
- bl1389UnlandedSiblingPathNeverRidesSteps.js: `the tip carries a path both ... changed`, `the shared
  path is in the replay`, `the report names ... as a passenger`, `the tree guards ran against the
  replayed tree`; plus `SHARED_PATH`, left unused by them.
- bl1465PassengerPropertyAssertsInPlanSteps.js: its six 01/02-only steps; plus
  `CHECK_FEATURE_HANDLER_REGISTRATION` and `putOnMain`, left unused by them.
Kept: `os` in bl1465/bl1466 - already unused before this parcel, not this ticket's.
Method: every registered pattern of the four handlers tested against every step line in
specs/features (tmp script, not committed); none left unmatched after the removal.

## Passenger census on the parcel tree (`grep -lis passenger`)
Features (14, as at mint) - all green, none asserts a passenger riding:
BL-1389 4/4, BL-1375 5/5, BL-1545 4/4, BL-1374 4/4, BL-1686 7/7, BL-1546 4/4, BL-1315 7/7,
BL-1442 11/11, BL-1466 4/4, BL-1472 4/4, BL-1465 2/2, BL-1544 4/4, BL-1717 1/1, BL-1830 3/3.
Property files (7, as at mint), each run alone: see below.
bl1389 3/3, bl1474 1/1, bl1830 1/1, bl1857 1/1, bl1546 2/2, bl1375 3/3, bl1717 1/1 - all green.
No scenario or property still asserts a passenger riding; nothing to raise to the specifier.

## QA procedure counts on this tree
BL-1375 5/5, BL-1465 2/2, BL-1466 4/4, BL-1389 4/4, BL-1830 3/3, BL-1717 1/1 - as measured at mint.
