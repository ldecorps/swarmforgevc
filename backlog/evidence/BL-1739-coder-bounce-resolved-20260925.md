# BL-1739 — architect bounce D1 resolved, 2026-09-25

The architect's bounce (`backlog/evidence/BL-1739-architect-bounce-20260925.md`,
commit `f7da69bd2a`) was built on the pre-rebuild lineage (cleaner's NONE
pass on `da235a4c38`, merged into architect, before this worktree's own
rebuild existed). D1 ("scenario-15 rebuild not done") describes exactly
the gap the rebuild commit `c4c81e8f57` (already an ancestor of this merge
- built from the specifier's own ruling note, per the ticket's "the coder
rebuilds the scenario-15 handler") already closed: `isAllowedBabysitterMatch`,
the orphaned step, and the `offenders` scan are gone; the remaining step
now checks `FORBIDDEN_RETIRED_PATTERNS` against live code across the same
five surfaces the bounce's own remediation pointer names.

Merged `f7da69bd2a` in cleanly (evidence-only - the architect's own
lineage never touched the code file, so nothing to reconcile); diffed
against both merge parents to confirm the rebuild fix rode through intact
(`git diff <merge>^1 <merge> -- specs/pipeline/steps/bl611BabysitterdLifecycleSteps.js`
empty, `isAllowedBabysitterMatch` absent). Re-ran the full feature after
the merge: 27 of 27, unchanged.

Full rebuild detail: `backlog/evidence/BL-1739-coder-rebuild-20260925.md`.

By coder.
