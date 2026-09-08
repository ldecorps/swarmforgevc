# Bounce-revert scope guard (BL-1471)

*How-to. Task-oriented: understand why a bounce revert was refused, and how
to clear it.*

Tier-1 commit-guard, sibling to
[`check_merge_deletion.sh`](BL-1242-merge-deletion-guard.md) (BL-1242) and
wired the same way that guard is: registered in
`swarmforge/scripts/run_commit_guards.sh` (pre-commit, always defers there —
see "Why two call sites" below) and enforced from
`swarmforge/git-hooks/commit-msg`, alongside `check_ticket_deletion.sh` and
`check_merge_deletion.sh`.

## What it catches

The BL-490/BL-495 bounce rule tells a reviewing role to revert the bounced
content out of its own branch, naming `git revert -m 1 <review-merge>` as
the route. A merge revert reverses the merge's **whole combined diff**
relative to the reverting branch's prior tip — not just the content that was
actually wrong.

The 2026-09-07 incident this guard exists for: QA bounced BL-1348 for a
missing scenario (class `spec-gap` — an omission, nothing the parcel added
was wrong) and ran the convention's own revert. QA's branch had not
independently taken BL-1348's earlier content before merging the
documenter's tip, so the revert stripped ruling B's implementation, its
tests, both vitest configs, three test files, BL-1348's own five evidence
files, and two unrelated tickets' evidence files (`BL-940`, `BL-1468`) that
had arrived through the same merged history. Only the coder restoring the
content on the next merge stopped the regression from reaching every
worktree via QA's merge-up broadcast.

`check_bounce_revert_scope.sh` refuses a staged revert commit in either of
two cases:

- **Cross-ticket scope.** Any path in the revert's diff is attributed to a
  ticket other than the one the reverted merge was actually bounced for —
  named per path, per ticket. Attribution reuses
  `check_merge_deletion.sh`'s own walk: the ticket id in the subject of the
  commit on the branch's own history that most recently touched the path.
- **Omission class.** The bounced ticket's latest bounce record (read from
  the shared `.swarmforge/bounces/*.jsonl` store) is an omission class —
  `spec-gap` or `invariant-unencoded` — mirroring
  `extension/src/quality/qaBounce.ts`'s `KNOWN_FAILURE_CLASSES` omission
  subset. An omission bounce names nothing the parcel added wrongly, so no
  revert is due at all; the whole commit is refused, not just the
  offending paths.

A revert scoped to the bounced ticket's own paths, for a wrong-content
class, passes. A non-revert commit is never judged (the guard exits 0
immediately on any subject that is not `Revert "..."`).

## Identifying which ticket a revert is for

The reverted merge's second parent almost always carries more than one
ticket's commits, so "whichever ticket id appears in the newest subject"
is not reliable — that shape is exactly what let BL-1348's revert also take
BL-940 and BL-1468's paths. The guard instead asks the bounce store
directly, in this order:

1. The bounce record (never a correction record) whose own `commit` field
   is an ancestor of the reverted merge's second parent — the store's
   `commit` is the parcel commit QA actually reviewed and bounced, so this
   is authoritative.
2. If no store record's commit resolves as an ancestor: the first
   ticket-shaped token found walking the second parent's own subjects.
3. If still nothing: the ticket named by whichever bounce record has the
   latest `at` timestamp across the whole store.
4. If the ticket still cannot be identified at all, the guard exits 0 —
   never blocks an unrelated revert it cannot attribute.

## Why two call sites, and the one gap that remains

Detecting "is this commit a revert" is a **message** question. Unlike a
merge — `MERGE_HEAD` is a file on disk the moment the merge starts — a
revert leaves no on-disk marker while it is applying cleanly. Empirically,
against this repo's own git, a clean, non-conflicting `git revert -m 1
<merge>` fires neither `pre-commit` nor `commit-msg`; only
`prepare-commit-msg` and `post-commit` do.

So `run_commit_guards.sh`'s call (pre-commit time, no finalized message
yet — githooks(5)) can only ever defer, and always exits 0; it is wired
there purely for the shared Tier-1 chain and BL-1408's derived fixture set.
`commit-msg`'s call, receiving the finalized message as `$1`, is the one
that actually enforces the guard — and it only fires for the commit shapes
that DO invoke commit-msg: an ordinary commit, or a **conflicted** revert
resolved by hand with a plain `git commit`, or a `git revert -n` staged and
committed manually.

**Known residual:** a clean, non-conflicting merge-revert's own auto-commit
is unreachable by any guard wired in this git version — flagged to the
specifier as a spec-gap alongside this ticket's evidence, not something
this ticket's scope extended to fixing. Until that gap closes, a role
reverting a bounce should prefer `git revert -n -m 1 <merge>` (stage
without auto-committing) and finish with a plain `git commit`, so the
guard actually sees the commit before it lands.

## If you hit this refusal

Cross-ticket scope:

```text
Error: revert touches 'backlog/evidence/BL-940-coder-spec-gap-20260906.md', attributed to BL-940, not the bounced ticket BL-1348.
Commit rejected: a bounce revert must touch only BL-1348's own paths; restore the other ticket(s)' content before committing (BL-490/BL-495's core is unchanged - a scoped revert is still due).
```

Restore the named path(s) to their pre-revert content and re-stage — the
revert is still owed for the bounced ticket's own content, only the
foreign paths need to come back.

Omission class:

```text
Error: revert <sha> is for BL-1348, whose latest bounce record is class 'spec-gap' - an omission bounce names nothing the parcel added wrongly, so there is nothing to revert.
Commit rejected: an omission-class bounce (spec-gap, invariant-unencoded) must not be reverted; leave the reviewed content in place and fix the omission going forward instead.
```

Drop the revert entirely — leave the reviewed content in place and address
the omission (the missing scenario, test, or doc) going forward instead.

## Where it lives

| Piece | Location |
| --- | --- |
| Guard script | `swarmforge/scripts/check_bounce_revert_scope.sh` |
| Wired into (deferring call) | `swarmforge/scripts/run_commit_guards.sh` (Tier 1) |
| Wired into (enforcing call) | `swarmforge/git-hooks/commit-msg` |
| Fixture test | `swarmforge/scripts/test/test_check_bounce_revert_scope.sh` |
| Property test | `extension/test/bl1471BounceRevertScopeInvariants.property.test.js` |
| Acceptance steps | `specs/pipeline/steps/bl1471BounceRevertScopeSteps.js` |
| Acceptance feature | `specs/features/BL-1471-a-bounce-revert-touches-only-the-bounced-tickets-paths.feature` |

## Related

- BL-490/BL-495 (bounce-revert-out-of-branch) — the convention this guard
  narrows; its core (bounced wrong content leaves the bouncing branch) is
  unchanged, this guard only refuses an over-broad or unnecessary revert.
- BL-1242 (`check_merge_deletion.sh`) — the sibling guard this one is
  modelled on and whose path-attribution walk it reuses; judges a merge's
  receiving side, never a revert.
- BL-1339/BL-1470 (shared-root bounce-store resolution) — this guard reads
  the bounce store at `git rev-parse --git-common-dir`'s parent, never the
  caller's own worktree root alone, the same fix BL-1470 needed.
- BL-1408 (commit-guard tests derive their guard set from the runner) —
  this ticket depended on it so the new guard needed no hand-copied
  fixture-list edit.
- BL-1348 (the incident) — QA's spec-gap bounce and wholesale revert
  (`108d9a46e7`) this guard exists to prevent a recurrence of.

## Verify

```bash
bash swarmforge/scripts/test/test_check_bounce_revert_scope.sh
npx vitest run --config vitest.properties.config.mjs test/bl1471BounceRevertScopeInvariants.property.test.js
specs/pipeline/scripts/run_acceptance.sh specs/features/BL-1471-a-bounce-revert-touches-only-the-bounced-tickets-paths.feature
```
