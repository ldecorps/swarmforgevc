# Fifth `main` reset-to-origin destroyed the BL-1200 close, two minutes after it was made

Recorded by the specifier while dispositioning QA's BL-751 / BL-1200 notes.
This is a BL-1214 recurrence (owned; **do not mint a new ticket**) with one new
and uncomfortable property: **it destroyed a remediation almost immediately
after that remediation was made, so the fix looked like it had never happened.**

## Sequence

| Time | Event |
|---|---|
| 01:52 | Specifier note to coordinator+QA: BL-1200 mis-pooled in `hold/` while in flight |
| 01:56:13 | Coordinator commits `7a9ee923a` "Close BL-1200: move to done" — acting on that note |
| 01:56:15 | Coordinator commits `c19823033` "BL topic record for BL-1200" |
| ~01:58 | `main@{1}: reset: moving to origin/main` → `e9fd27b9c` (QA rematch tip). **Both commits destroyed.** |

`e9fd27b9c` is QA's "merge: rematch tip onto origin/main before BL-1190 land",
so the reset that discarded the coordinator's two local-ahead commits happened
around the rematch operation — the same shape BL-1198 exists for ("main rematch
reset must attempt push before discarding local ahead commits"). No push was
attempted for those two commits before they were discarded.

## Why it nearly went unnoticed

Nothing reported an error, and the misleading signal was self-consistent: the
coordinator's commits *succeeded*, and the ticket simply read `hold/` again — so
the state was indistinguishable from "the coordinator never actioned the note".
It surfaced only because a routine check produced a contradiction: the reflog
showed a "Close BL-1200" commit while `git ls-tree main` still showed `hold/`.

The one-line test that settles it, worth running on your own recent commits
after any interaction with a rematch merge:

    git merge-base --is-ancestor <commit-from-reflog> HEAD || echo DESTROYED

A `git commit` that succeeded minutes ago is not evidence the commit is still in
the lineage. `git log --all` cannot see reset casualties — only the reflog can.

## Recovery (human-authorised push)

1. `git branch -f rescue/main-5th-reset-20260828 c19823033` — one ref captured
   both (linear chain), verified with `--is-ancestor`.
2. `git cherry-pick 7a9ee923a c19823033` — clean; the pool move replayed as a
   100% rename, so no content was reconstructed by hand.
3. **Pushed in the same turn.** Parity `origin/main..main` = 0.
4. Verified by reading `backlog/done/BL-1200-*.yaml` and
   `backlog/topics/BL-1200.json` back off `origin/main`, and confirming the
   recovered blob byte-identical to `c19823033:`'s before deleting the rescue
   ref.

## The operative lesson

The reset can only discard commits that are **ahead of origin**. The window
between committing on shared `main` and pushing is now measured in **minutes**,
not hours. Push in the same turn you commit — a recovery that is not pushed is
not a fix, it is a countdown. This is the fifth occurrence in one night, and the
second in which a *previous recovery* was itself destroyed.

By specifier.
