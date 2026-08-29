# BL-1247 (reconcile-sweep-kill-switch) — architect bounce, 2026-08-29

## What happened

The cleaner's handoff (task name `BL-1247-bl593-property-generator-emits-values-its-own-contract-refuses`,
commit `68a16b9ec3`) is a merge of coder `26ac974ca` into cleaner's tip `f4d872e04`.

Both the task name and the coder-side commits/tickets are for an **unrelated**
BL-1247: `backlog/active/BL-1247-bl593-property-generator-emits-values-its-own-contract-refuses.yaml`
(medium severity, BL-593 property-test scope generator fix). A collision in
ticket numbering means a second, unrelated, **critical**-severity ticket also
carries id BL-1247: `backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml`
(human-ruled 2026-08-28 12:16Z: "Disable the master-main-reconcile sweep until
BL-1236 lands" — the kill switch for the mechanism that has destroyed
committed work 13 times).

The merge commit `68a16b9ec3` **silently deletes**
`backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml` (189 lines) even
though this is a clean, non-conflicting case:

- Real merge-base of the two merge parents (`f4d872e04`, `26ac974ca`) is
  `4963a0bf9`, where the file is **absent** (it did not exist yet on either
  side's common ancestor).
- The file was added only on the cleaner side (`f4d872e04` has it, unchanged
  since its own creation at `0a754dad5`).
- The coder side (`26ac974ca`) never had it — that branch diverged from
  `4963a0bf9` before it existed, and does not touch it at all.

A correct 3-way merge keeps a file added on only one side with no conflicting
change from the other side. Instead the merge result drops it entirely. This
matches the "entangled-revert merge silently drops whole new files" class of
defect (see prior incidents BL-1192/1201/1216/1211) — some step in the
cleaner's merge process (stash pop, cherry-pick, hand-resolution, or similar)
clobbered the file instead of a plain `git merge`.

## Why this is a send-back, not a routine pass-through

Merging `68a16b9ec3` as-is into any downstream worktree (architect, hardener,
QA, main) reproduces the same clean one-sided-delete pattern relative to that
branch's own history, so it would delete the ticket file there too — the
critical kill-switch ticket would disappear from the active pipeline a second
time, undoing the coder's already-completed implementation
(`master-main-reconcile-lib/reconcile-enabled?`, wired into
`handoffd.bb`'s `master-main-reconcile-sweep!`) from backlog bookkeeping even
though the code itself may still be present elsewhere (seen live on
`swarmforge-hardender` at `eec753d29`/`0a754dad5`).

I did NOT merge `68a16b9ec3` into the architect worktree, to avoid propagating
the loss further down the pipeline.

## Remediation

Cleaner: redo the merge of coder `26ac974ca` into your branch. Do not use
whatever mechanism dropped the file (audit for a `git checkout --theirs`,
manual stash resolution, or non-merge history rewrite around this parcel).
After merging, verify
`backlog/active/BL-1247-reconcile-sweep-kill-switch.yaml` is still present
and unchanged, then re-forward. If it truly is not needed on this branch,
that decision belongs to the specifier (ticket-id collision adjudication),
not to a silent merge drop — surface it as a `note` instead of dropping it.

## Commit reviewed

`68a16b9ec3` (cleaner's merge of coder `26ac974ca`).
