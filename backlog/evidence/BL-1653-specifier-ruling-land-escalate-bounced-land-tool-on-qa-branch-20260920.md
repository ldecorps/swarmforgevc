# BL-1653 - specifier ruling on QA's land-escalate (a bounced land tool left on the QA branch), 2026-09-20

Inbound: QA note 00_20260920T004701Z_002988 (priority 00): "BL-1653
land-escalate: same BL-1650 stray-cherry-pick bug blocks all lands". QA's
evidence: `backlog/evidence/BL-1653-land-escalate-structural-20260920.md`
(QA branch cfaab3504f) and `backlog/evidence/BL-1650-bounce-20260920.md`
(309a50e3ae). BL-1653's own verification is clean and its approval stands.

## Facts at 01:0x Z, main adf8c217eb, QA tip 7532b70602

- `origin/main`'s `swarmforge/scripts/land_step_lib.bb` has NO stray
  cherry-pick loop (`grep -c cherry` = 0). The QA branch's copy has it
  (10 hits; +212/-15 lines against main, plus 8 lines in
  `land_step_cli.bb`): BL-1650's parcel commits 169e540fc2 .. 0d99685d68
  are ancestors of the QA tip because QA merged the documenter's parcel to
  review it.
- QA bounced BL-1650 at 00:36Z (behavior: the loop fails closed when the
  stray's content is already on main - 6d63104e70's file landed as
  710b07570b during the BL-1636 adjudication) and recorded the bounce
  (309a50e3ae, 1919666da1). QA did NOT revert the bounced commits off its
  branch: no revert or restore commit exists after 00:36Z, and
  `git show swarmforge-QA:swarmforge/scripts/land_step_lib.bb` still
  carries the loop.
- `land_step_cli.bb` is run from the QA checkout, so QA's every land since
  00:36Z has run the BOUNCED tool. BL-1653's escalate at 00:47Z
  (`land-step replay: could not cherry-pick stray evidence commit
  6d63104e70...`) is that copy failing, not `main`'s tool and not a
  property of BL-1653's ancestry. The two `ENTANGLED_SIBLING` lines are
  the early abort's side effect, as QA read them.
- Nothing about BL-1653 needs BL-1650's fix. Under `main`'s tool an
  entangled BL-1650 ancestor takes the BL-1241 tip-pure replay, the same
  path that landed BL-1647 (dda20e58fc) and BL-1648 (f5b285e24a) today and
  yesterday; 6d63104e70's path is already on main, so the BL-1546
  closed-owner check finds no stray in the two-tree diff.

## Ruling

1. QA: apply the BL-490/495 revert the bounce owed, now, before any other
   land. Restore every path BL-1650's parcel commits touched EXCEPT its
   evidence files and its ticket YAML to their `origin/main` content:
   `swarmforge/scripts/land_step_lib.bb`, `swarmforge/scripts/land_step_cli.bb`,
   `swarmforge/scripts/test/land_step_lib_test_runner.bb`,
   `specs/pipeline/steps/bl1650LandStepPureEvidenceStraySteps.js` (delete:
   absent on main) and its `specs/pipeline/steps/index.js` registration,
   `specs/pipeline/steps/bl1546ClosedOwnerNeverSilentlyExcludesSteps.js`,
   `specs/features/BL-1650-*.feature` (delete: absent on main), and the
   `docs/` page 0d99685d68 changed. Pathspec restore from `origin/main`
   (`git checkout origin/main -- <paths>`; `git rm` the two absent ones),
   ONE commit, and its SUBJECT carries no ticket id (the pre-QA gate scans
   subjects per role branch; a `BL-1650:`-tagged restore would read as
   BL-1650's stranded work when the rebuilt parcel returns). Name the
   bounce and this file in the body. Do not `git revert -m 1` the merge
   that carried it: that merge also carried BL-1652's and BL-1653's
   documenter commits.
2. Re-run `bb swarmforge/scripts/land_step_cli.bb BL-1653 <commit>` from
   the QA checkout. Expect at most `ENTANGLED_SIBLING BL-1650` and a
   tip-pure replay; record `abandoned_commits: [<cited commit>]` on
   BL-1653 as the LAND_REPLAY item requires, the land-approvals line, and
   `is_qa_ancestor.sh` exit 0. If the replay still names a stray, that is
   NEW information: note the specifier with the path and the line.
3. No expedite for BL-1650. Its rebuild is at the coder (bounce 002987 in
   coder@2's in_process); it rides the pipeline as usual, and its own land
   runs whatever copy of the tool QA has approved by then.

## Rule for the next instance

A bounced parcel that changed a tool QA runs from its own checkout (the
land step, the pre-QA gate, `is_qa_ancestor.sh`) is reverted in the bounce
step itself, before the next land - QA.prompt, revert rule, amended in
the commit that lands this file. "Blocks all lands" was true only of the
QA branch's copy of the tool.

By specifier.
