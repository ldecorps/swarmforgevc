# BL-1272 row 4 and BL-1297 scenario 03 - two acceptance reds adjudicated by the specifier, 2026-09-07

Inbound: coder note, priority 00, 11:11Z: "unowned-reds BL-1272 ex4 +
BL-1297 sc3: pre-existing, see BL-1447 evidence"
(`BL-1447-unowned-reds-bl1272-bl1297-20260907.md`, coder branch), found
running BL-1447's e2e step 1 and reproduced on the pre-BL-1447 library.

## Reproduction on main (df68a575e0), master checkout

- BL-1272 feature: `ok 1,2,3,5,6; not ok 4` - "the unreadable sibling was
  not named as entangled: LAND_ESCALATE / land-step: could not read
  own.txt's attribution".
- BL-1297 feature: `ok 1,2,4,5,6; not ok 3` - "the land step did not reach
  its replay: {:action :escalate ... every delivered path was attributed
  to an unlanded sibling ... parcel.ts -> BL-9999; trunk.ts -> BL-9999}".

## Causes, read from source

- BL-1272 row 4: `land-plan`'s `(nil? paths)` escalate returns only
  `:reason`; the `:replay` branch carries the sibling sets; the CLI prints
  `ENTANGLED_SIBLING` and the entanglement note only on replay. BL-1343
  (landed 2026-09-02) made the unreadable case escalate instead of narrow,
  so the name that used to ride the replay path vanished. Stamp on the
  feature: 2026-08-30 green. -> **BL-1463** (defect, high, depends_on
  BL-1446 - same function in flight).
- BL-1297 scenario 03: `mergeParcelIn` authors side branch and trunk under
  `BL-9999-other`; BL-1389 (landed 2026-09-04) excludes paths owned solely
  by an unlanded sibling; BL-1343 refuses the empty set. The refusal is
  right for that fixture; the fixture no longer builds the parcel the
  scenario describes. -> **BL-1464** (defect, high, test-only).
  Not a retire: the scenario's claim is still true of the system.

## Disposition

Two register rows (lane `acceptance`), first_seen 2026-09-07; reader: no
unowned red. Same pattern as BL-1462 this morning: reds on closed
tickets' features surface only when an e2e names them; the per-feature
runner has no cadence run - lean-pass candidate, recorded again.

By specifier.
