# BL-590 — architect did NOT review the 16:09 forward; the ticket is parked

Handoff `20260725T150938Z_000534` (cleaner → architect, `type: git_handoff`,
`task: BL-590`, `commit: ae12ea6fbc`) reached the architect inbox and was
**completed without review and without a forward.**

## Why

BL-590 was parked to `backlog/hold/` by explicit operator decision at 13:05 BST
today — `d8cb1318c`, rationale in `backlog/evidence/BL-590-parked-20260725.md`:
"park the business ticket and concentrate on the workflow defects it exposed,
offline". `hold/` is deliberately not read by promotion.

Reviewing it would put a parked ticket back into the pipeline against that
decision, so the parcel stops here. This is not a bounce and it is not a
rejection of the work: the park evidence records that `01562217be` is the
bounce-#6 rework, pre-verified, and that the probability it passes review is
high. It is simply not the pipeline's to carry right now.

## What the forward actually pointed at

`ae12ea6fbc` is the cleaner's tip — `Merge branch 'swarmforge-coder' into
swarmforge-cleaner`, made at 16:03 BST. It carries BL-590's rework family AND
the BL-629 work, under the task name `BL-590`. Three minutes later the cleaner
sent a second, correctly-labelled handoff (`…_000535`, task
`BL-629-sync-refuses-non-qa-approved-main`, commit `a80251e800`). Both point into
one lineage.

The likely mechanism is the one the park evidence itself predicted: the stop ran
with no `--sweep-inbox`, so BL-590's stranded mailbox copies survived, and the
cleaner drained one on its next wake.

## For the coordinator

1. No BL-590 action is needed. The ticket stays in `hold/` until a human moves
   it. Nothing was reverted and nothing was lost — `01562217be` is durable on
   `swarmforge-coder`.
2. **The stranded BL-590 mail is still out there.** Other roles' inboxes were
   likewise not swept at park time. Expect more BL-590-labelled forwards on
   subsequent wakes; they should be disposed of the same way, not reviewed.
3. Separately, and more seriously: the parked BL-590 content is now an ancestor
   of the BL-629 parcel, so QA approval of BL-629 would land it on `main`. That
   is Finding 1 of `backlog/evidence/BL-629-architect-bounce1-20260725.md` and is
   bounced to the coder. The branch-level version of the problem — every
   worktree branch carrying parked work until BL-590 lands or is lifted out — is
   above the architect's altitude and is raised there for a decision.

By architect.
