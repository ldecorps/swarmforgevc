# BL-465-recently-closed-not-sorted-by-recency — QA bounce 2026-07-17

1. **Failing command**:
   ```
   git merge-base --is-ancestor 0784e346 3c3c64ac10
   ```
   (checking that the hardener's BL-465 bounce-fix commit is an ancestor of
   the documenter commit QA was handed — the "Forwarded Commits Carry Their
   Lineage" check every stage owes the next.)

2. **Commit hash checked out and tested**: `3c3c64ac104db47360572043917acef6eb6280c4`
   ("Document BL-465 bounce: recently-closed sorted by actual closure
   recency", By documenter.)

3. **First error excerpt**:
   ```
   $ git merge-base --is-ancestor 0784e346 3c3c64ac10
   <exit 1, no output — 0784e346 is NOT an ancestor of 3c3c64ac10>
   ```
   `3c3c64ac10` is a single-parent commit (parent `1d4d0c6bf2`, "Document
   BL-469 per-agent steering-topic icons") — it descends entirely from the
   BL-469 documentation lineage and never merges the BL-465 bounce-fix chain
   (`af080c9b` coder → `aebbd9eb` cleaner → `730e7053`/`b35b26eb`/`e3cb1655`
   architect → `0784e346` hardener). Confirmed by diffing the actual source:
   ```
   $ git show 3c3c64ac10:extension/src/concierge/conciergeTick.ts | grep -c doneClosedAtMs
   0
   $ git show 0784e346:extension/src/concierge/conciergeTick.ts | grep -c doneClosedAtMs
   (present — TickState.doneClosedAtMs, recentlyClosedItems sort, stampNewlyDoneClosedAtMs)
   ```
   The commit's own diff is docs-only (`docs/reference/Specification.MD`,
   +3/-1) — none of the coder/cleaner/architect/hardener code or test changes
   for the actual sort fix are present in the tree QA was handed.

4. **Failure class**: `integration` — a lineage/forwarding failure, not a
   behavior bug in the fix itself (the fix, as landed by the hardener at
   `0784e346`, is sound — see below). The documenter forwarded a commit built
   on an unrelated (BL-469) lineage instead of merging the BL-465 hardener
   commit it was handed, so none of the real fix reached QA.

5. **Expected vs observed**: Expected — the documenter's forwarded commit has
   the hardener's BL-465 commit (`0784e346`) as an ancestor and contains the
   `doneClosedAtMs` durable-timestamp sort fix. Observed — the forwarded
   commit `3c3c64ac10` has no such ancestry; `recentlyClosedItems` in its tree
   is still the pre-fix, unsorted `folders.done` passthrough, so the original
   defect (recently-closed section not sorted by actual closure recency)
   remains completely unfixed in what was handed to QA.

## Note
The underlying fix at `0784e346` (and its ancestors back to the coder's
`af080c9b`) reads as a correct, well-tested implementation on inspection —
this is not a request to redo the fix, only to correctly merge it forward.
The re-entry point for the bounce is `coder` per protocol, but the actual
repair needed is at the **documenter** stage: merge `0784e346` (or later) into
its BL-465 lineage before re-documenting and re-forwarding.
