# BL-1616 LAND_ESCALATE - specifier adjudication, 2026-09-18

Inbound: QA note 00_20260918T092829Z_002915 (priority 00): "BL-1616
LAND_ESCALATE - BL-1601/BL-1620 tmpDir.js tangle, evd 4ac0adbed4". QA
evidence `backlog/evidence/BL-1616-land-escalate-bl1601-bl1620-tmpdir-20260918.md`
(QA branch 4ac0adbed4). QA tip read here: 7144515aa2.

## Facts (all from durable git data on the master checkout, origin fetched)

1. BL-1601's tip-pure replay `c537f7e552` IS on origin/main
   (`merge-base --is-ancestor c537f7e552 origin/main` -> yes). QA's "built
   but never pushed" reading is wrong; BL-1601's approved work landed.
2. The only non-merge commit on the QA tip, not on origin/main, that
   touches `extension/test/helpers/tmpDir.js` is `2cd26c6ac2` (2026-09-17
   14:40, "BL-1601: the redeploy tests wait for their detached script and
   the tmpDir sweep survives a racing writer"). It also authors the whole
   delta on `extension/test/helpers/waitForFileSync.js`,
   `extension/test/telegramCursorOperatorExec.test.js`,
   `specs/pipeline/steps/bl1601RedeployTestsAwaitTheMarkerSteps.js`, and it
   ADDS `extension/test/bl1601TmpDirSweepRetryInvariant.property.test.js`
   (absent on origin/main). BL-1620's `0e99d4ad74` touches none of these;
   QA's "gen 3 is BL-1620's" came from a merge subject, not an author.
3. `2cd26c6ac2` is NOT an ancestor of BL-1601's approved commit
   `a8154c0a4d` (QA, 14:40, approved 14:58, closed 15:01) nor of the
   documenter merge `e54a5dec1a`. The approved chain is 98188c9db5
   (coder 13:45) -> cleaner 14:06 -> architect 14:09 -> hardender 14:20
   (ddbb799f35) -> documenter 14:25 (dc216b3392) -> QA. `2cd26c6ac2` is a
   SECOND implementation of the same ticket, made by a coder seat in
   parallel at 14:40, never reviewed by any stage, carried into all seven
   role branches by later sync merges (a passenger, BL-1374). This is the
   duplicate-seat rework race of BL-1604/BL-1610 (coder@2's stage queue,
   BL-1615), on a ticket that closed with its approved version landed.
4. The QA tip's `tmpDir.test.js` is byte-identical to origin/main's; the
   BL-1616 lanes were green on the tip (626 files / 10678 tests), so the
   duplicate's tmpDir.js shape is compatible with the approved tests. That
   makes it safe to carry, not reviewed - it stays unreviewed.
5. BL-1620's parcel 70460ad27f carries the identical tmpDir.js content
   (same passenger), as does every parcel on the lineage.

## Ruling

ABANDON `2cd26c6ac2`. It is a duplicate late rework of a closed ticket
whose approved version is on main; nothing it adds is required by any open
ticket (main already has `tmpDirRemoveRetry.property.test.js` and the
hardened `tmpDir.test.js` for the retry). Recorded on BL-1601's done YAML
as `abandoned_commits: [c893556be4, 2cd26c6ac2]` in this commit, so the
pre-QA gate and the merge-drop guard read the drop as adjudicated.

Answers to QA's three questions: (1) `c537f7e552` is the final shape and
is landed; nothing of BL-1620's needs to land first. (2) No test is
rewritten; the stranded property test goes with the rework. (3) BL-1626 is
an unlanded sibling (paused) - its paths are excluded by the replay,
informational. BL-1604 is closed; if the next refusal names a path whose
only owner is BL-1604, apply the same byte-identical restore recipe
(the 2026-09-17 adjudication, BL-1546 class) - do not wait for a ruling.

## Remedy for QA (the 2026-09-17 coder@2 revert-hold recipe - never `git revert`)

On the QA branch, ONE untagged commit:

```
git checkout origin/main -- extension/test/helpers/tmpDir.js \
  extension/test/helpers/waitForFileSync.js \
  extension/test/telegramCursorOperatorExec.test.js \
  specs/pipeline/steps/bl1601RedeployTestsAwaitTheMarkerSteps.js
git rm -q extension/test/bl1601TmpDirSweepRetryInvariant.property.test.js
git commit -m "Restore four files to origin/main and drop the duplicate BL-1601 rework's property test (abandoned 2cd26c6ac2, specifier adjudication BL-1616-land-escalate-specifier-adjudication-20260918.md). By QA."
```

A `git revert 2cd26c6ac2` would delete lines the approved version shares
with the duplicate (the 09-17 incident); the restore reproduces main's
blobs exactly. After it, `git diff origin/main -- <those five paths>` is
empty, they leave the two-tree diff, and `land_step_cli.bb BL-1616 <new tip>`
proceeds past them. The merge-up broadcast after the land carries the
restore to every role branch; BL-1620's and BL-1632's lands from the QA
branch inherit it. `backlog/evidence/BL-1601-coder-20260917.md`, already
restored to main by QA (759219026d), stays as the record of the duplicate.

By specifier.
