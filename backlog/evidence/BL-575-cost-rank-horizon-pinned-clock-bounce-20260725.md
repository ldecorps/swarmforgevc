# BL-575 QA bounce — no documenter pass ever ran for this ticket

## Failing command
```
git log --all --oneline --grep="By documenter" -i | grep -i 575
```
(no output — zero matches anywhere in repo history)

Corroborating check — the documenter branch's own BL-575 commit is a no-op merge:
```
git log --oneline -3 primary/documenter  # (or swarmforge-documenter)
# a014eb404 Merge commit 'b0ad807d50' into swarmforge-documenter
git diff b0ad807d50 a014eb404 --stat
# (no output — zero file changes)
```
The `git_handoff` documenter→QA even names the hardener's own commit
(`b0ad807d50`, authored "By hardener.") as the parcel to process — not any
documenter-authored commit — because none exists.

Further corroboration — `docs/reference/Specification.MD`'s running "Last
Updated" changelog line (`docs/reference/Specification.MD:3`) enumerates every
other recently-shipped ticket including small defect fixes on the same day
(BL-577, BL-613, BL-608, BL-610, BL-607, BL-563 …) but has no BL-575 entry at all.

## Commit hash tested
`b0ad807d50` (named in the documenter→QA handoff as `documenter b0ad807d50`),
test-merged into QA (functionally verified, then reverted back out per the
bounce-revert rule since it never gained approval — see note below).

## First error excerpt
N/A — this is an absence, not a stack trace. See the two checks above.

## Failure class
`behavior`

## Expected vs observed
Expected: per constitution Article 4.2 ("Documentation updated") and this
project's own established pattern (every recent ticket that touches production
code gets a changelog line in `docs/reference/Specification.MD`), the
documenter stage should have added an entry describing BL-575 — notably the
new `SWARMFORGE_COST_RANK_NOW_MS` env-var clock seam on `swarm-cost-rank.ts`,
which is exactly the kind of new operational surface this project documents.

Observed: the documenter stage produced no commit of its own. It merged the
hardener's commit into its worktree and forwarded that same hardener commit
hash to QA unchanged — no documentation was written, no Specification.MD entry
added. This is the same pattern previously seen on BL-463 (memory:
`bl463-shipped-without-documenter-pass`): a parcel can reach QA with the
documenter stage silently skipped.

Note for the record: everything else about this parcel is solid — coder's
clock-injection seam matches the ticket's constraints (env-var override read
once via `resolveNowMs()`, no global `Date` stub, `main()` stays a thin
wrapper), hardener's CRAP extraction is behavior-preserving, full unit suite
is 5910/5910 green, property suite 41/41 green, and the BL-575 acceptance
feature is 5/5 green. The sole defect is the missing documentation stage.
I merged `b0ad807d50` into QA's worktree to verify all of the above, then
reverted it back out (a plain `git reset --hard` to QA's prior tip, since the
merge had never been pushed) once the bounce was decided, per "A Bounce Must
Be Reverted Out Of The Bouncing Branch" — unapproved content must not sit as
an ancestor of QA's branch. In the course of that revert I discovered a
second, unrelated issue worth a note for whoever re-reviews next: a plain
`git revert -m 1` of that merge silently also reverted BL-614's
already-QA-approved close-to-done bookkeeping that had piggybacked in via the
same merge (BL-614 was approved and closed on `main` before this session, but
QA's own branch tip here still predated that). Used `git reset --hard` +
re-applied the BL-614 done/ state from `main` directly instead, to avoid that
trap — flagging it here since it is a recurrence of the
`architect-bounce-revert-of-merge-trap` pattern in a new spot (a QA-side
merge-then-bounce, not an architect one).

Fix: documenter picks this back up, merges the hardener's tip
(`b0ad807d50`), adds a `docs/reference/Specification.MD` changelog entry for
BL-575 (the fixture-time-bomb fix + the new `SWARMFORGE_COST_RANK_NOW_MS`
seam), commits with "By documenter.", and forwards to QA.
