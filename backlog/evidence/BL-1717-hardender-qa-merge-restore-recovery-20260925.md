# BL-1717 hardender: QA merge-up (BL-1724 fc032a07f3) silently tried to revert the BL-1717 rebuild fix

QA's BL-1724 approval note ("BL-1724 QA-approved fc032a07f3 - merge your
branch up to QA's") required merging `fc032a07f3` into this worktree.
QA's own BL-1717 bounce evidence
(`backlog/evidence/BL-1717-QA-20260925.md`, "Bounce-step tool restore")
had already flagged this exact hazard: QA's branch runs the land step
from its own checkout, so `land_step_lib.bb` and
`land_step_lib_test_runner.bb` were restored to origin/main (pre-BL-1717)
on QA's side in an untagged commit, and warned that merging it back
"would otherwise silently revert the rebuild's non-overlapping BL-1717
hunks."

It did exactly that:

- `swarmforge/scripts/land_step_lib.bb`: a real conflict (`UU`), git's own
  markers. Resolved by keeping HEAD's side (the BL-1717 rebuild clause) —
  confirmed byte-identical to the pre-merge parcel HEAD via
  `diff <(git show HEAD:...) <(cat ...)` before committing.
- `swarmforge/scripts/test/land_step_lib_test_runner.bb`: git AUTO-MERGED
  this one with NO conflict marker, and silently took QA's (restored,
  pre-BL-1717) side — 59 lines, the entire BL-1717 test block, gone with
  no warning. `grep -c "BL-1717"` on the auto-merged file: 0. This is the
  dangerous case per engineering Guardrails ("A merge can silently revert
  already-landed work — diff every merge against BOTH parents"): a real
  conflict at least stops and asks; a clean auto-merge does not.

Recovery: restored both files to the parcel (HEAD) side byte-for-byte
(`git show HEAD:<path>` captured before resolving, diffed against the
resolved result — identical for both), staged, ran
`land_step_lib_test_runner.bb` (ALL PASS) before committing the merge.

Post-commit verification against BOTH parents (BL-571/BL-958/BL-954
discipline):
- `git diff HEAD^1 HEAD -- <both files>`: empty — the merge result is
  byte-identical to the parcel's pre-merge HEAD, so nothing my own
  rebuild pass added was lost.
- `git diff HEAD^2 HEAD -- <both files>`: re-adds exactly the BL-1717
  hunks on top of QA's restore — the merge is additive over parent 2, not
  a silent discard of parent 1.
- `grep -c "BL-1717"` on the merged files: 1 (`land_step_lib.bb`, the
  clause's own comment block) / 5 (`land_step_lib_test_runner.bb`, the two
  new test cases and their comments) — both present.
- `bb swarmforge/scripts/test/land_step_lib_test_runner.bb`: ALL PASS.
- `node specs/pipeline/cli.js specs/features/BL-1717-a-landed-co-owner-never-shields-an-unlanded-siblings-lines.feature`:
  2/2 ok.

Merge commit: `6f6a1651cd`.

This is not a new BL-1717 code defect — the rebuild fix itself is
unchanged and correct (see
`backlog/evidence/BL-1717-hardender-20260925-2.md`, already forwarded).
It is a merge-mechanics hazard QA's own bounce evidence already named and
warned the next merger about; recorded here as the concrete instance
because a clean auto-merge silently discarding a whole test block with no
conflict marker is exactly the failure QA's warning existed to prevent,
and it is worth a durable record that the warning was heeded and the
recovery verified against both parents, not just re-run and assumed fine.

By hardender.
