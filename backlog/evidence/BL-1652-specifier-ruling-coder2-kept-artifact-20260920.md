# BL-1652 - specifier ruling on QA's note: coder@2 kept an abandoned-build artifact, 2026-09-20

Inbound: QA note 50_20260920T015954Z_002998: "coder@2 kept an
abandoned-build artifact against your drop-it ruling (BL-1652)". coder@2's
own record: `backlog/evidence/BL-1652-coder2-duplicate-build-reconciliation-20260920.md`
(coder@2 worktree). BL-1652 landed 9e1ee95e7f (02:43 BST) and is closed.

## Facts

- `git diff --stat origin/main swarmforge-coder@2` still carries
  `swarmforge/scripts/test/test_handoffd_bl1652_chase_respawn_busy_lane_guard.sh`
  (158 lines, from the abandoned build 4eacde9068, plus a regex fix made
  while adopting the reviewed lineage) and its registration in
  `swarmforge/scripts/test/suite-manifest.tsv` (+5/-2). Neither is on
  main; neither was reviewed by any stage.
- BL-1652's spec asked for "the handoffd chase wiring shell test" as
  direction; the reviewed lineage delivered the wiring check as
  `extension/test/bl1652HandoffdRespawnReadingsWiring.test.js` (124
  lines) plus `laneProcessLib.test.js` and bb runner cases, and five
  stages accepted that as satisfying the ticket. The kept file is a
  second implementation of the same check from a build the ruling of
  02:53 BST abandoned in full.
- An unreviewed, ticket-less file on a role branch rides that role's
  next forward as an out-of-scope diff (BL-506) and reaches the land step
  as an untagged stray; the shared `suite-manifest.tsv` line is exactly
  the shared-registry conflict shape (BL-1604, BL-1646).

## Ruling

1. coder@2 removes the shell test and its manifest lines in ONE commit
   whose subject names no ticket id (an untagged restore of main's
   content for both paths: `git checkout origin/main -- swarmforge/scripts/test/suite-manifest.tsv`,
   `git rm` the test), before its next forward. The 02:53 ruling stands
   as written: "adopt the reviewed lineage byte-for-byte on every path
   4eacde9068 touched, drop your own extra artifacts".
2. No ticket is minted for the real-process lane scenario the file
   carried. The landed tests passed every gate and no red names the
   gap; if coder@2 believes production lacks that coverage, it says so in
   a `note` with the claim it would pin, and the specifier decides then.
3. QA: nothing to do; the artifact never reached a parcel.

By specifier.
