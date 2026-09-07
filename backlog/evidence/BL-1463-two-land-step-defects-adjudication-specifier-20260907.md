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

## Second and third instances, 2026-09-07 evening (appended on QA's note 18:14Z holding BL-1408)

- **BL-1408** (QA tip `3c8581c68b`, verified green, held un-landed):
  `land_step_cli.bb` escalated "nothing to commit for BL-1408 - own-paths
  identical to origin/main" while `origin/main` has zero occurrences of
  `commitGuardFixtureSet` and the tip has it. Against `origin/main`
  `45ab7eaec2`: two-tree diff 114 paths, the parcel's own range
  (merge-base `53a5898899`..tip) 49, so 65 spurious - 4 deletions
  (BL-1475's YAML and feature, the specifier's index-lock adjudication
  evidence, BL-1463's done YAML), 1 resurrection (BL-1463's active YAML),
  60 REVERSIONS (59 topic records under `backlog/topics/` and
  `swarmforge/roles/specifier.prompt`, the human directive landed as
  `20c741a4f9`). The deletion guards refused; the reversion half has no
  guard and would have landed silently had no deletion been among them.
  Same class, no new mechanism: BL-1473 (D2 first half) and BL-1474 (D2
  second half) own it; QA's hold is correct, its route is below.
- **BL-1461's first replay `04049f4bb2`** (15:58:17) DID land the reversion
  half silently: `backlog/topics/BL-1465.json` went back to `aefc4b0927`'s
  content, erasing the message the daemon had appended at `e8f00bd562`
  (15:54:36, seq 2, ts 1788792876687); the daemon's later write
  `4966fa95d2` (16:19) did not restore it and `origin/main` lacks it now.
  Data loss on `main` by the integration step -> **BL-1473 re-classed
  `critical`**, **BL-1474 re-classed `high`** (its false reason fired twice
  in one day and will fire on every replay until BL-1473 lands). The same
  replay's and `496bf2d9ae`'s touches on `swarmforge/roles/QA.prompt` are
  the parcels' own edits, not reversions (checked). No other replay on
  `origin/main` since BL-1315 touched a foreign topic record, role prompt
  or constitution file.

## Interim, strengthened (QA prompt, same commit)

Sync `origin/main` into the QA branch IMMEDIATELY before running the land
step and run it on that tip: a two-tree diff against a tip that already
contains `origin/main` carries nothing main gained, lost or changed since
the fork, so the BL-1473 half vanishes and the guards have nothing to
refuse; a clean sync merge adds no untagged touch (BL-1374 elides a merge
TREESAME to a parent, and a clean auto-merge authors no lines). If the
escalate still reads "nothing to commit", main moved between the sync and
the step: sync once more and re-run; if it persists, rebuild the commit by
hand and read stderr (BL-1474). The hand-built tip-pure commit from the
evidence-listed paths stays the fallback. BL-1408 lands by this route.

By specifier.
