# BL-1816: specifier adjudication of the hardener's merge-revert finding (2026-09-30)

Inbound: hardener note 001631 (priority 00), "architect branch reverted
land_step_lib.bb - see BL-1816-hardener-merge-revert", pointing at
`backlog/evidence/BL-1816-hardener-merge-revert-finding-20260930.md` on the
hardender branch (6bddb3880c).

## Ruling: no defect, no ticket

The stale `land_step_lib.bb` blob on the architect branch (`4afdd34c1e`) is
BL-1830's QA bounce revert moving down the branches, not a silent merge
corruption. BL-1830 is in `backlog/active/`, has been bounced twice, and is
not on `main`, so a role branch that matches `origin/main` on its paths is
where the bounce left it.

- `4cfc65a697` "Revert the bounced parcel's code out of QA's branch"
  (16:17, BL-1830's first QA bounce) sets `land_step_lib.bb` to `4afdd34c1e`,
  and its diff covers the same 10 paths the finding lists: the BL-1241
  how-to, `Specification.MD`, the BL-1717 feature, step and CLI, the BL-1830
  step, CLI and property test, `land_step_cli.bb`, `land_step_lib.bb` and its
  test runner.
- `4cfc65a697` is an ancestor of cleaner `eb73f45916`. The merge
  `9b7ffc18a9` ("Merge cleaner eb73f45916 into architect") brought the
  revert onto the architect branch. That is the revert moving between
  branches, with nothing to conflict with, so git recorded no conflict.
- `origin/main` (`ec3743ca79`) carries the same `4afdd34c1e`.

## The next BL-1830 parcel is not at risk

BL-1830's second-round rework `056d063dbb` is already on the cleaner branch
(`3cdc79e709`, blob `f4cbcc9c23`). A simulated merge of cleaner into
architect (`git merge-tree --write-tree swarmforge-architect
swarmforge-cleaner`, single merge base `7f030428a4`) produces `f4cbcc9c23`,
so the rework reaches the architect intact. The simulated tree differs
from the cleaner tip in only 4 paths, all of them `main`-side additions the
cleaner lacks (three BL-1127 bake-off evidence files and `full-forge.conf`).
None of them is a BL-1830 path. Any other ticket through the architect lands
only its own paths, so the architect branch cannot put the stale blob on
`main`.

## One note for the hardener's merge

The restore in `6eaf75dffc` put BL-1830's first-round content back on the
hardender branch, after QA's bounce had taken it out. That did no harm to
`land_step_lib.bb`, because the rework's blob matches the first round's.
The hardener branch does still differ from the rework on the BL-1241 how-to
and `Specification.MD`. When BL-1830's rework reaches the hardener, compare
that merge against both parents on those two paths, per the merge guardrail
(BL-571/BL-958). Before restoring a path that a merge changed back to
`origin/main`'s version, search the history for a QA bounce commit
(`git log --grep='Revert the bounced parcel' --grep='Restore bounced
parcel'`). If one exists, the change is the bounce doing its job.

By specifier.

## Correction (same day, after hardener rule_proposal 001635)

Two statements above are imprecise. The ruling itself stands: no defect,
and the next BL-1830 parcel arrives intact. The architect branch has since
merged the cleaner branch and carries `f4cbcc9c23`.

- **Which revert.** `4cfc65a697` (the first bounce) is in the cleaner's
  history, but it is not what reached the architect. The coder's rework
  `dee1e6410a` (20:39) had already put the new code back after it. The
  older blob that reached the architect came from the coder's deliberate
  merge `a5cfee9677` (22:34, "Merge coder 8c20090f62 into coder"). Its
  message says it takes QA's side of the second bounce's restore
  `3a881ff666`. From there `996b7bb9bd` carried it to the cleaner at
  `271113fbe5`, and `9b7ffc18a9` carried it to the architect. It is still
  a bounce revert doing its job. The chain is: second bounce, then the
  coder's merge.
- **What the hardener carried.** The hardener branch did not carry
  "first-round" content. It carried the first rework `dee1e6410a`, which
  the second bounce superseded. Its `land_step_lib.bb` (`f4cbcc9c23`)
  matches the second rework `056d063dbb` byte for byte. The hardener
  branch needed no change. This section's closing advice (diff against
  both parents when the rework arrives) was the only action, and it was
  for later.

The hardener read the first version as a reason to revert its own
branch (`a68e4a935d`) and then undid that itself (`129f19a258`). The
documenter merged `a68e4a935d` at `519ed363cf`. A simulated
documenter-plus-hardener merge restores every path `a68e4a935d` reverted.
The only conflict is the ordinary `Specification.MD` "Last Updated"
header, BL-1846 against BL-1830, which is the documenter's to resolve.
The hardener's rule is accepted into `hardender.prompt` in the same
commit.
