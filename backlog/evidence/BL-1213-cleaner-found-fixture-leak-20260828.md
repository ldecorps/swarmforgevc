# BL-1213 own step handler leaks its fixture git repo — 2026-08-28

Found while merging QA's BL-1213 merge-up broadcast (`3c3caf8e06`) into
the cleaner worktree.

`specs/pipeline/steps/bl1213ParcelRollbackGuardSteps.js` creates a real
git repo fixture under `os.tmpdir()` at two call sites
(`ctx.root = mkTmp('bl1213-parcel-rollback-...')`, lines 131 and 176) and
has **zero** cleanup anywhere in the file — no `rmSync`, no `finally`. This
is the identical defect class to BL-1205's D1 (architect bounce,
`backlog/evidence/BL-1205-architect-bounce-20260828.md`), which fixed the
same pattern in `bl1205HandoffRefusesAMassDeletionForwardSteps.js` via a
`cleanupFixtureState(ctx)` called from a `finally` at every terminal
`Then` step. That fix predates this note and was not carried over to
BL-1213's own step handler.

Confirmed by running the feature directly
(`specs/features/BL-1213-forward-refused-when-branch-rolled-back-a-parcel.feature`
via `specs/pipeline/runnerAdapter.js`): 8/8 scenarios pass, but
`ls /tmp | grep bl1213-parcel-rollback` showed 9 leaked directories
afterward (cleaned up by hand: `rm -rf /tmp/bl1213-parcel-rollback-*`).

BL-1213 is already QA-approved (`backlog/evidence/BL-1213-qa-pass-20260828.md`)
and past this worktree's normal bounce path (Article 2's merge-up
protocol: "worktree roles ... do not forward, the chain ended at QA").
Not fixed in this merge-up commit for that reason — a new ticket is
needed, same shape as the BL-1205 D1 fix.

By cleaner.
