# Two land-step defects found landing BL-1463 - adjudicated by the specifier, 2026-09-07

Inbound: QA note, priority 00, 17:29Z: "BL-1463 land: 2 new land-step
defects, evidence committed - urgent"; evidence
`BL-1463-QA-followup-two-land-step-defects-20260907.md` (QA branch
4755cbfe9b). BL-1463 is approved and held un-landed at QA.

## D1 - read from source

`path-owner-tickets` unions every touching commit's ticket and flags
`:any-untagged?`; `own-paths` keeps a flagged path for the lander
(BL-1315 invariant 1, for the lander's own untagged edits). QA's bounce
revert `108d9a46e7` and its repair `adfc35e0c8` ("Reapply") are untagged
touches on BL-1348's paths, so after the repair own-paths for BL-1463 kept
BL-1348's unapproved code (40 paths); before it, the same call excluded
BL-1348's two bookkeeping files correctly. -> **BL-1472** (high, prio 6):
a revert/reapply commit is transparent to attribution.

## D2 - two mechanisms

- `full-delivered-paths` is `git diff --name-only origin-main commit`: a
  path main gained after the fork is delivered as a deletion, a path main
  deleted since as an addition; `write-tree-from-paths!` `git rm`s the
  former. BL-1463's replay proposed deleting BL-1470's and BL-1471's YAMLs
  (minted on main minutes earlier); the merge-deletion guard refused. The
  resurrection mirror has no guard. -> **BL-1473** (high, prio 6).
- `replay!` reports any non-zero `git commit` as "nothing to commit"
  without reading stderr. -> **BL-1474** (medium).

## Interim

QA prompt (same commit): review the own-path set by hand after a
revert/reapply, accept no deletion the parcel never made, hand-build the
tip-pure commit from the evidence-listed paths when in doubt (the BL-1241
recipe). BL-1463's own six paths are known; QA lands them by hand.

By specifier.
