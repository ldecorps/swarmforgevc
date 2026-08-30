# BL-1297 hardener → documenter send blocked — 2026-08-30

Hardening work is complete and committed (`2d49d9d6e5`, evidence at
`backlog/evidence/BL-1297-hardener-pass-20260830.md`). Attempting
`swarm_handoff.sh` to forward to the documenter fails with TWO distinct
refusals, both worth recording because the second is the fix's own gate
catching a shape its own ticket did not fully anticipate.

## Refusal 1 — duplicate-chain guard sees the reverse-hop copy as still live

```
Cannot send git_handoff for BL-1297: a live parcel for this ticket already
exists at specifier (00_20260830T175000Z_001295_from_architect_to_specifier_
for_specifier.handoff). If that parcel is genuinely stale, clear it first:
redo_from.sh BL-1297 <stage>
```

That handoff is the reverse-hop `back-all` copy the architect's forward
`git_handoff` synthesized (Article 2.3 "Reverse hops") when it forwarded to
hardener — `non-forwarding: true`, and already `dequeued_at`/`completed_at`
stamped in `.swarmforge/handoffs/specifier/inbox/completed/`. It is not an
outstanding parcel by any read of its own file, but
`duplicate_chain_guard_lib.bb` still treats it as blocking. I have not run
`redo_from.sh` — it is a salvage tool ("restarting a work item") outside the
hardener's role and its side effects on a shared, multi-worktree in-flight
ticket are not mine to judge unilaterally.

## Refusal 2 — the entangled-tip guard the fix itself implements, self-triggered

```
Cannot send git_handoff for BL-1297-a-merge-commits-own-paths-are-not-empty:
this task's own commits since its last handoff carry 11 paths (...) belonging
to BL-1295,BL-1272,BL-1298,BL-676,BL-677,BL-816,BL-875,GH-24, not to BL-1297
- the tip is entangled with another ticket's work (BL-1192/BL-506). Rebuild
or cherry-pick a tip-pure commit for BL-1297 and re-send.
```

Root cause, verified directly (not guessed):

- `last-handoff-commit` for BL-1297 at hardener resolves to `513d840d97`
  (architect's tip, cited in the payload I received:
  `merge_and_process architect 513d840d97`).
- `git rev-list --first-parent HEAD | grep -c 513d840d97` → `0`: that base
  is NOT on my branch's first-parent chain. I received it as a `git merge`
  (second parent), which is how every stage receives a handoff.
- My own receive-merge commit `d4e74ea3d1`'s subject is
  `Merge architect 513d840d97 into hardender (receive handoff BL-1297). By hardener.`
  — it names BL-1297, so `commit-message-names-task?` makes it a candidate.
  `own-commit-changed-paths` (this ticket's own new function) then diffs it
  against ITS first parent (`1f136dcbcf`, my prior hardener tip) — which is
  the entire content the merge brought in, including whatever "pass-through
  bookkeeping" (newly-landed/paused tickets BL-676, BL-677, BL-816, BL-875,
  GH-24, plus BL-1272/BL-1295/BL-1298 backlog edits) rode along on the
  architect/cleaner branch's own routine `Merge main into <role>` syncs.

This is not a defect in the fix's own correctness — `own-commit-changed-paths`
answers exactly the question it says it answers (BL-1297's own scenario 04
proves single-parent commits are unaffected, and the merge case is what this
ticket exists to make visible). It IS a newly-exposed collateral effect the
ticket's own text flagged as unverified: "QA did not verify whether callers 2
and 3 are actually invoked with a merge-commit citation in real operation,
and neither did I." Caller 2 (this send-time gate) is now exercised for real,
for the first time, because this is the first hardening pass to run with the
fix already live in its own worktree — every prior pass's receive-merge
subjects that name a ticket id were silently exempt only because the OLD bug
made every such merge's own-commit-diff empty.

The two remedies the tool itself names both sit outside a hardener's normal
authority: `redo_from.sh` (salvage/restart machinery) and a tip-pure
rebuild/cherry-pick of a multi-hundred-commit branch whose ancestry spans the
entire session's worktree-drift storm (already a live, separately-tracked
incident: `worktree-drift-storm-20260830-reverse-hop-files` memory). Forcing
either through unilaterally, on a shared repo, mid-storm, risks compounding
that incident rather than resolving this ticket.

## Disposition
Not reverting or altering the hardening commit. Reporting as a live incident
via priority-00 note to the specifier rather than working around it -
per Article 4.4's spec-gap-leaves-as-a-note guidance and this session's
standing practice for delivery-machinery incidents (BL-1295's own land
escalate went the same route). The commit (`2d49d9d6e5`) remains ready to
forward the moment either blocker is cleared by whoever owns that call.
