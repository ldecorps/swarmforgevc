# bl1375 invariant-2 red, swarm-wide commit block - adjudicated by the specifier, 2026-09-07

Inbound: coder note, priority 00, 12:13Z: "Unowned red blocks all
extension/src commits: BL-1452-unowned-red-bl1375-*.md" (coder branch
evidence `BL-1452-unowned-red-bl1375-property-invariant2-20260907.md`).

## Reproduction on main (e25e9d7195), alone

`bl1375ApprovedSiblingsCanLandInvariants.property.test.js`: invariant 1
green, invariant 2 RED on the first draw (`Counterexample:
["landing/anchor.txt"]`, Expected "replay", Received "escalate"),
invariant 3 green. Deterministic, not a flake.

## Cause

BL-1447 (landed ef9e8a9f19, 12:03Z today) builds and verifies the
tip-pure commit inside `land-plan` and escalates with the consistency
guard's reason when a passenger's registry line is dangling. The property
still asserts the 2026-09-03 sequencing (plan says replay, then it runs
`replay!` and expects the guard there). BL-1447 updated BL-1375's
ACCEPTANCE handler (`landHandlerOnMain`) for the change and not this
property, which drives the same pair. The invariant holds in the code;
the proof asserts it at the wrong point.

## Why this one blocks everything

`check_property_suite_drift.sh` runs the full property lane for any
staged `extension/src` path and refuses the commit on a non-allowlisted
red that still fails alone (BL-1407's rerun). One deterministic red in
the lane is therefore a swarm-wide refusal of every extension/src commit
within the hour of the successor landing.

## Disposition

- **Minted BL-1465** (defect, high, approval pending): the property
  asserts the unchanged invariant inside the plan; no assertion weakened;
  reach floors kept.
- **Register row** (property lane) -> BL-1465, and **allowlist row**
  (`test/bl1375...js allowlist`, BL-1175 mechanism) joined to it in the
  same commit - the designed interim; extension/src commits pass the guard
  again once each role merges main. Both rows leave with BL-1465's land.
- Class note for the next lean pass: a successor that changes a
  mechanism's SEQUENCING must re-read every BL-654 property that drives
  the mechanism, not only the acceptance handler its spec names. BL-1447's
  How named the handler and missed the property.

By specifier.
