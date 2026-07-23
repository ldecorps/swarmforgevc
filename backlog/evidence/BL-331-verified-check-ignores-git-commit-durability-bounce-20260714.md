# BL-331 (task: bl331-verified-check-ignores-git-commit-durability) QA bounce evidence — 2026-07-14

## Failing command
```
git merge-base --is-ancestor db415d60dd 5570ed817f7ce9740e56365085074592fb5c788a
```
(exit code `1` — the hardener's own handed-off commit, `db415d60dd`, is NOT an
ancestor of the documenter's forwarded commit.)

## Commit hash
`5570ed817f7ce9740e56365085074592fb5c788a` (documenter's forward). Its actual
parent is `090b83b7eece787690da0e19ccbe1cf4da5cbdc8` (the prior BL-369 docs
commit) — not `db415d60dd`, the commit named in the documenter's own inbound
handoff (`merge_and_process hardender db415d60dd`,
`.swarmforge/handoffs/inbox/completed/00_20260714T080514Z_000238_from_hardender_to_documenter_for_documenter.handoff`).

## First error excerpt
```
$ git merge-base --is-ancestor db415d60dd 5570ed817f7ce9740e56365085074592fb5c788a
$ echo $?
1

$ grep -n "recordIsCommitted\|isRecordCommitted\|isFileCommitted" \
    <(git show 5570ed817f:extension/src/concierge/topicDeletion.ts) \
    <(git show 5570ed817f:extension/src/concierge/blTopicStore.ts)
(no matches — every symbol the fix introduced is absent from the shipped tree)
```

## Failure class
`behavior` — the shipped commit does not contain the git-commit-durability
gate the ticket's own task name names as its scope. Root cause is a dropped
merge (an `integration`-shaped defect: same family as BL-090/103), but the
observable result is a behavior gap: `decideTopicDeletion` in this commit's
tree still has the pre-fix signature and will delete a topic whose record
merely *parses* as complete on disk, even if that record was never actually
git-committed.

## Expected vs observed
Expected: this ticket's own architect bounce (`21706868`, "gate topic
deletion on git-commit durability, not just content") landed and was
verified by the hardener (merge `db415d60`, task
`bl331-verified-check-ignores-git-commit-durability`) — `decideTopicDeletion`
takes a `recordIsCommitted: boolean` and treats a verified-but-uncommitted
record as unverified (`isFileCommitted`/`isRecordCommitted` in
`gitCommitScopedFile.ts`/`blTopicStore.ts`), so an `appendMessage` write that
succeeds on disk but fails to `git commit` (the exact window
`CommitFailureReporter` exists for) never causes a topic delete.

Observed: the documenter's forwarded commit (`5570ed817f`) is built directly
on top of the prior `090b83b7` (BL-369 docs) commit, never merging in
`db415d60` at all. `topicDeletion.ts#decideTopicDeletion` and
`blTopicStore.ts` in this tree still match the ORIGINAL, pre-bounce coder
commit (`b78775b5`) — no `recordIsCommitted` parameter, no
`isFileCommitted`/`isRecordCommitted` anywhere. The documentation prose in
this same commit (`docs/Specification.MD`) accurately *describes* the
git-commit-durability fix in detail — so the docs describe behavior the
shipped code does not have. Merging this parcel would ship the exact
data-loss window the ticket exists to close: a topic whose record was
written but never actually committed to git (lost on a fresh
checkout/`git clean`/disk failure) could still be deleted, because the
running code has no way to tell the difference.

## Root cause (why this happened, not just what broke)
Same class as the BL-090/103 precedent named in `workflow.prompt`'s
"Forwarded Commits Carry Their Lineage": the documenter received
`merge_and_process hardender db415d60dd` but committed its docs change
without first running `git merge db415d60dd` — so its own outbound forward
carries none of the hardener-verified work, only the docs text describing
it. The prose is correct; the merge that was supposed to bring the code
along with it never happened.

## What to fix
1. In the documenter's worktree, actually merge `db415d60dd` (or the current
   tip of the hardener's BL-331 work) before re-committing/re-forwarding —
   `git merge-base --is-ancestor db415d60dd <new-commit>` must hold.
2. Re-verify after merging that `topicDeletion.ts`'s `decideTopicDeletion`
   takes `recordIsCommitted` and that `isFileCommitted`/`isRecordCommitted`
   are present in `gitCommitScopedFile.ts`/`blTopicStore.ts`.
3. The documentation prose itself (the BL-331 paragraph added to
   `docs/Specification.MD`) reads correct against the intended fix — it can
   likely be carried forward unchanged once it sits on top of the right code.
