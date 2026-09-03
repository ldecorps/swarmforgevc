# BL-1354 — LAND SUCCESS, 20260903

Follows `BL-1354-qa-approval-20260903.md` (full independent verification,
APPROVE, `d92c972dcf`).

## `land_step_cli.bb` still escalated — root-caused with the FIXED tool itself

`bb swarmforge/scripts/land_step_cli.bb BL-1354-a-shared-path-does-not-hide-
a-landed-sibling d92c972dcf .` returned `LAND_ESCALATE`:
`specs/pipeline/steps/index.js is shared with unlanded sibling(s)
BL-1296,BL-1328,BL-1337,BL-1346,BL-1351`.

This is BL-1354's OWN fixed code reporting this, so it needed a real
diagnosis rather than the pre-fix reflex. Queried `entangled-siblings` and
`sibling-own-line-changes` directly (`bb -e`, loading the just-merged
`land_step_lib.bb`):

- Checked each named sibling's OWN require line in `index.js`:
  `BL-1328`, `BL-1337`, `BL-1346`, `BL-1351` each already have their line on
  `origin/main`, byte-identical. `BL-1296` has NO line on either side
  (its step file was reverted — correctly vacuous, nothing to carry).
- So the fix IS working for this path — none of these five would actually
  carry unlanded content into `index.js`.
- What still reads "unlanded" is each ticket's OVERALL verdict, dragged
  down by UNRELATED trailing content: mostly this worktree's own post-land
  bookkeeping commits for those tickets (a `land-success` evidence file
  that was never itself pushed to `origin/main`, and — for BL-1337
  specifically — its ticket yaml renaming from `active/` to `done/`
  between the cited commit and `origin/main`, the same rename-is-not-
  content-answerable shape the coder's own BL-1354 evidence names for
  BL-1323).
- This is real and correctly out of BL-1354's declared scope: the ticket
  fixes the per-SIBLING landed/unlanded verdict (aggregated across ALL of
  that sibling's attributed paths), not a per-PATH-scoped verdict at the
  `own-paths` exclusion site — its own notes say plainly "only the landed/
  unlanded split feeding it changes," and wiring changes are explicitly
  BL-1309's territory, not this ticket's. Not a defect in what was built;
  a narrower remaining gap one layer up, worth a future ticket but not a
  reason to bounce a parcel that does exactly what it claims.

## Hand-built tip-pure commit, same discipline as every land this session

- Own-paths (16 files) derived and cross-checked the same way as every
  prior land today: `git diff origin/main d92c972dcf --stat -- <16 paths>`
  matched the full `origin/main..d92c972dcf` diff's non-other-ticket subset
  exactly (16 files, 1453 insertions, 10 deletions out of the full diff's
  46 files); the other 30 files independently confirmed as other tickets'
  own bookkeeping (BL-1296/1328/1337/1342/1344/1345/1346/1351/1359/1360/
  1361/667/1317).
- Built on temp worktree/branch `bl1354-landtry`, off `origin/main` at
  `bfb998f413`. Re-verified on the tip-pure tree before commit (symlinked
  `node_modules`, compiled fresh): compile clean;
  `land_step_lib_test_runner.bb` ALL PASS; acceptance 5/5;
  `bl1354SharedPathLandedSiblingInvariants` property test 2/2.

## Landed, with one bounded rematch

- First push attempt rejected (non-fast-forward): `origin/main` advanced
  by one unrelated commit (`Approve BL-1361`, ticket yaml only) between
  fetch and push. Per BL-1144 discipline: fetched, `git rebase origin/main`
  (clean, no conflicts), re-confirmed the diff was still exactly the same
  16 files/1453 insertions/10 deletions, pushed again. One rematch, bounded
  — no loop.
- Pushed: `2ca871426e..80d26b9ae8` to `origin/main`.
- `swarmforge-QA` merged up to `80d26b9ae8`. No code conflicts (pulled in
  unrelated concurrent bookkeeping: BL-1337 active→done rename, BL-1359
  paused→active promotion, BL-1360/1361 minted).
- Temp branch `bl1354-landtry` and its worktree removed;
  `.swarmforge/land-main.publish.lock` released.
- No `abandoned_commits` needed — no bounce occurred and the QA-approval
  commit (`d92c972dcf`) is a plain evidence commit with nothing else riding
  on citing it further.

By QA.
