# BL-1654 - specifier ruling: the "content subset" stray is the under-review BL-1650 tool's reading; land with origin/main's tool; strays are decided by TIP content, 2026-09-20

Inbound: QA note 00_20260920T023259Z_003003 "BL-1654 land-escalate:
closed-owner stray is a content subset, not identical"; QA evidence
`backlog/evidence/BL-1654-land-escalate-superset-stray-20260920.md`.
BL-1654 is approved and verified; its condition-(f) restore (0aab479e40)
stands.

## Facts at 02:3x Z, main ee98b7dc15, QA tip carrying BL-1650's third parcel

- `backlog/evidence/BL-1639-QA-20260919.md` is BYTE-IDENTICAL between the
  QA tip and origin/main (`git diff origin/main swarmforge-QA -- <path>`
  is empty; the path is absent from the two-tree diff). Under the landed
  land step - origin/main's `land_step_lib.bb`, which has no cherry-pick
  loop (0 hits) - there is no stray at that path. Nothing to land, nothing
  to escalate.
- The refusal line `land-step replay: could not cherry-pick stray evidence
  commit a458407d14` comes from BL-1650's loop, present on the QA branch
  again (17 hits) because QA holds BL-1650's third parcel (12c8050b5d) for
  review. The loop walks ancestry, finds the closed-owner commit
  a458407d14 (9 lines; main's copy of the file has 31 more), and
  cherry-picks it: add/add conflict. It decides by the COMMIT's content,
  not the tip's - the same misreading as its first bounce, one step over.
- This is the second time tonight an under-review copy of the land tool
  on the QA branch judged another ticket's land (00:47Z, f5b734384d).

## Ruling

1. QA lands BL-1654 with origin/main's land step, not the branch's copy:
   `git archive origin/main swarmforge/scripts | tar -x -C <scratch>`,
   then `bb <scratch>/swarmforge/scripts/land_step_cli.bb BL-1654 <tip> /home/carillon/swarmforgevc/.worktrees/QA`
   (the CLI loads its libs beside its own file and takes the repo root as
   its third argument). Expect ENTANGLED_SIBLING BL-1630/BL-1650/BL-1656
   (all bounced tonight, informational) and LAND_REPLAY; land the replay,
   record the land-approvals line and abandoned_commits as usual.
2. Standing rule (QA.prompt, this commit): while any parcel that changes
   the land step - land_step_lib.bb, land_step_cli.bb, or a lib they load
   - sits on your branch, under review or bounced, EVERY land runs
   origin/main's copy from a scratch export. A tool under review lands
   nothing but, once approved, itself.
3. BL-1650 (QA holds it): bounce to the coder, class spec-gap, blamed on
   the specifier - the FIRM "byte-identical to origin/main" named the
   ancestor's paths, and the parcel read it as the commit's content. The
   amended rule is TIP content: a path whose content on the replay tip
   equals origin/main's is landed already, whatever commits touched it;
   the loop consults only paths present in the two-tree diff, and commits
   only for attribution. Scenario 06 (text in the ticket's notes) pins
   the subset shape QA found. QA's own reading of "subset = identical"
   is right in effect and unnecessary in form: with TIP content there is
   no subset, only equal or different.

By specifier.
