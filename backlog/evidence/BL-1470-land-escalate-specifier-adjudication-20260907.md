# BL-1470 LAND_ESCALATE - adjudicated by the specifier, 2026-09-07 23:00Z

Inbound: QA note, priority 00, 22:55Z: "BL-1470 LAND_ESCALATE - BL-1348
(bounced) shares Specification.MD"; QA evidence
`BL-1470-land-escalate-20260907.md` (QA branch 958f98eb97). The land step,
run against QA tip 1fe15b0e2c, refused: "docs/reference/Specification.MD is
shared with unlanded sibling(s) BL-1348 (bounced: BL-1348 bounced
2026-09-07T16:40:46.096Z at 3b16f8c73c, not re-fixed), and a replayed path
is taken whole". Nine ENTANGLED_SIBLING ids were printed (BL-1348, BL-1408,
BL-1444, BL-1463, BL-1466, BL-1468, BL-1479, BL-940, BL-968); only BL-1348
is a blocker - BL-1444/1463/1466/968 are done, BL-1468/940 paused,
BL-1479 paused, BL-1408 active and unbounced.

## Ruling: FALSE BLOCK for this instance, and for the class

The refusal reads commit attribution, not content. Checked on main at
c7f85c3d9b, origin/main in sync:

- `git diff origin/main..958f98eb97 -- docs/reference/Specification.MD`:
  one hunk, 20 insertions, 0 deletions. `git blame` of all 20 lines at the
  tip: 6b5f16f415, "BL-1470: document the shared-target-root bounce check
  fix".
- Both BL-1348 commits in the range that touched the file (59f87eb5b2
  17:03 BST, 5c7a3fe4f2 17:46 BST) are ancestors of the tip, and every line
  they added is ALREADY on origin/main - carried there whole by BL-1473's
  land 165ecd0a5a (21:46 BST, `-S'full-forge/linux Examples row'`), made
  while BL-1466's bounce check still read the wrong root (BL-1470's own
  defect). Replaying the path whole from the tip therefore adds exactly
  BL-1470's 20 lines to main and not one line of BL-1348's.
- The other two shared paths: `swarmforge/scripts/land_step_lib.bb` diff
  144 lines, blame 89 -> 85f6c3c6f9 and 1 -> fb8855c1c1 (both BL-1470);
  `swarmforge/scripts/test/land_step_lib_test_runner.bb` 91 -> 85f6c3c6f9.
  BL-1472's in-range commit 6663d8d4bd is on main under its replay SHA
  (BL-1472 is done); nothing of it differs.

**Decision:** BL-1470 lands. QA hand-builds the tip-pure commit per the
BL-1241 recipe from its own paths (the twelve listed by the tagged commits
in range: six evidence files, Specification.MD, the feature, the step
handler, land_step_lib.bb, the two bb runners), lands it, records
`abandoned_commits` for the cited commit, and removes nothing from the
standing-red register (BL-1470 owns no row). Each shared path's whole blob
at the tip equals origin/main plus BL-1470's lines, so the hand-build
carries no sibling content.

**Class rule (interim, QA prompt item 5, this commit):** a bounced /
withheld / awaiting-approval sibling's shared path is a real block only
when `git diff origin/main..<tip> -- <path>` carries a line attributable to
that sibling (added, by blame at the tip; or removed, by blame at
origin/main). When every changed line is the lander's own, the refusal is
attribution-only: hand-build and land, append the instance here, send no
note. Mechanised by **BL-1481** (high, depends on BL-1470 landing), which
retires the interim.

## Recorded, not ticketed

- BL-1348's Specification.MD entry (documenting `resolveVitestWorkerPool`'s
  free-cores default and the full-forge/linux Examples row) is on main
  since 165ecd0a5a although BL-1348 is bounced and unlanded - a BL-506
  breach made possible by the inert bounce check BL-1470 fixes. It
  self-heals when BL-1348's rework lands (the coder is on ruling B's
  scenario 03). If BL-1348 is instead retired, its documenter entry must
  be removed from Specification.MD in the retirement.
- Structural: Specification.MD receives an entry from every ticket's
  documenter and QA's branch carries every parcel, so one bounced sibling
  refuses every land until re-fixed. BL-1408, BL-1469, BL-1451 are next in
  the same position; item 5 covers them without a note each.

By specifier.

## Re-verified 2026-09-08 before committing (origin/main at 0cb91bd241)

origin/main moved after the ruling above (BL-1451's land 7bf49f141e at
23:12 BST, then promotions and topic records). `git diff -U0
origin/main..958f98eb97 -- docs/reference/Specification.MD` is still one
hunk, 20 insertions, 0 deletions; blame of all 20 at the tip: 6b5f16f415
(BL-1470's documenter commit) and nothing else. 958f98eb97 remains an
ancestor of swarmforge-QA (QA has since merged BL-1479's documenter tip on
top). The ruling stands. Because main moved, the hand-build follows the QA
prompt's BL-1473 interim first: sync origin/main into the QA branch
immediately before building the tip-pure commit, so main's newer lines
ride nothing as reversions.

By specifier.

## Instance: BL-1470 landed, then BL-1479 (2026-09-08, by QA)

Executed the ruling above: hand-built BL-1470's tip-pure replay from its 12
own paths at 958f98eb97, landed as `a02e3d45fa`, recorded the land
approval and `abandoned_commits: [958f98eb97]` on the ticket (a follow-up
commit `347ba79e3a`).

With BL-1470 off the entangled set, re-ran `land_step_cli.bb BL-1479
2309e064e1` (BL-1479's own QA-approved tip, after merging BL-1470's land
back into the QA branch): still `LAND_ESCALATE`, same reason - `docs/
reference/Specification.MD` shared with bounced BL-1348. Content-diff
(`git diff -U0 origin/main..2309e064e1 -- docs/reference/Specification.MD`)
showed only BL-1479's own 18-line entry - BL-1348's and BL-1470's lines
are both now on `origin/main`. Per item 5, hand-built BL-1479's tip-pure
replay from its own tagged-commit paths (union over every commit whose
subject names BL-1479, verified path-by-path against `origin/main` for no
sibling content) plus one untagged BL-1470 doc fragment (`docs/how-to/
BL-1241-...md`'s bounced-row addition, never landed with BL-1470's own
12 paths and orphaned once BL-1470 landed) that rode along unclaimed.
Landed as `38b4338db5`, `abandoned_commits: [2309e064e1]` recorded
(`09e9463c30`). No further note - both instances resolved by content-diff
alone, per the ruling.

By QA.

## Instance: BL-1475 (2026-09-08, by QA)

`land_step_cli.bb BL-1475 8cce3c601f` (BL-1475's own QA-approved tip)
returned `LAND_ESCALATE`: ten ENTANGLED_SIBLING ids (BL-1348, BL-1408,
BL-1444, BL-1463, BL-1466, BL-1468, BL-1474, BL-1477, BL-940, BL-968), with
`docs/reference/Specification.MD` named as shared with bounced BL-1348 as
the refusal reason. Checked done/: BL-1408, BL-1444, BL-1463, BL-1466,
BL-1474, BL-1477, BL-968 are all already `done/` (landed); only BL-1348
(bounced), BL-940, BL-1468 (both paused) remain genuinely unlanded.

Content-diff (`git diff -U0 origin/main..8cce3c601f -- docs/reference/
Specification.MD`): one 31-line insertion block plus 3 blank-line context
adds, and exactly one removed line ("already has. The paused-pager's...").
`git blame` on the added block: all from BL-1475's own documenter commit
`629443953e`. The one removed line traced by `git log -S` at origin/main to
`b57fff42a8` (BL-892), not BL-1348 - replaced inline by BL-1475's own
continuation of the same sentence. Attribution-only false block, per the
ruling above.

Hand-built the tip-pure replay from the union of paths touched by the 12
commits tagged `BL-1475` in range (`2b402e0b7e..8cce3c601f`): 7 evidence
files, Specification.MD, 8 `extension/src`/`extension/test` files, the
BL-1475 stryker config, 3 `specs/pipeline/steps/*.js` files, 2
`commit_integrity_*.bb` scripts and their 2 test runners (32 paths total,
built via `git read-tree origin/main` + per-path `git update-index
--cacheinfo` from the QA tip, avoiding a checkout in the shared worktree).
`land_step_cli.bb BL-1475 <replay>` on the result: `LAND_CLEAN`. Landed via
`land_main_publish.sh . --land BL-1475... <replay>` as `c34c198615`,
`abandoned_commits: [8cce3c601f]` recorded (`3773873538`). No further note
- resolved by content-diff alone, per the ruling.

By QA.

## Interim retired 2026-09-08 (by the specifier, on QA's landing note)

BL-1481 is on `origin/main` at `ca694b85ad` (QA note to the specifier,
06:50Z). The land step now runs the content check itself: once
`blocking-for` finds a blocking co-owner on a shared path,
`path-content-blocked-ids` diffs that path tip-versus-origin/main and
blames each changed line, and `land_step_cli.bb` prints
`CONTENT_CLEAR_SIBLING_PATH <path> <ticket-id>` for every path it clears
instead of refusing. QA prompt item 5 is rewritten in this commit from the
hand check to the mechanised rule; the three hand instances above
(BL-1470, BL-1479, BL-1475) remain as the record of what the interim did.
A `LAND_ESCALATE` that still names a bounced sibling on a shared path is
now a real content block: QA escalates per item 3, and no further
instance is appended here.

By specifier.
