# BL-465-recently-closed-not-sorted-by-recency — QA bounce 2026-07-17 (3rd bounce, blocked by shared commit)

This is a DIFFERENT reason than the first bounce this session
(`BL-465-recently-closed-not-sorted-by-recency-bounce-20260717.md`, wrong
lineage / fix never merged). That problem is RESOLVED: this documenter
forward correctly carries the hardener's real fix (`0784e346`) as an
ancestor this time.

1. **Failing command**: none of BL-465's own fix — it is blocked because it
   shares a commit tree with BL-469, which fails (see
   `BL-469-per-agent-steering-topic-icons-bounce-20260717.md` and its `-b`
   follow-up).

2. **Commit hash checked out and tested**: `29f0ceae44` (QA's merge of
   documenter commit `201143deec`, which correctly has hardener commit
   `0784e346` as an ancestor this time — verified:
   `git merge-base --is-ancestor 0784e346 29f0ceae44` succeeds, and
   `extension/src/concierge/conciergeTick.ts` contains `doneClosedAtMs`,
   `recentlyClosedItems`, `stampNewlyDoneClosedAtMs`).

3. **First error excerpt**: N/A — BL-465's own fix is independently verified
   CORRECT:
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-465-pipeline-board-render-round2.feature` → 11/11
     pass.
   - `extension/test/conciergeTick.test.js` carries two dedicated regression
     tests constructed so folder-array order and true closure order
     DISAGREE (`BL-465 bounce: RECENTLY CLOSED sorts by actual closure
     recency, never by folders.done listing order`, and the first-tick
     pre-existing-done edge case) — both pass, part of the 5066/5066 green
     full-suite run.
   - The fix is a durable per-ticket `doneClosedAtMs` stamp (set once, on
     first observation in `folders.done`) that `recentlyClosedItems` sorts
     against, descending — correctly replacing the prior silent
     alphabetical/directory-listing-order re-sort.

4. **Failure class**: `integration` — not a defect in BL-465's own fix; it
   cannot land independently because it is committed together with BL-469's
   defective icon table in the same tree (this documenter commit descends
   from the same `6a8ee5e1` combined hardener batch as the BL-475/477/469
   bounces sent earlier this session).

5. **Expected vs observed**: Expected — a clean, correctly-lineaged parcel
   forwards to `main`. Observed — bounced because the tree it descends from
   still carries BL-469's unresolved icon collision; landing this commit
   would ship that defect to `main` as a side effect of landing BL-465's
   otherwise-correct fix.

## Note
No rework needed for BL-465 itself — the fix and its lineage are both
correct now. Once the coder fixes BL-469's icon collision and the batch is
re-forwarded through cleaner/architect/hardener/documenter, BL-465's fix
rides along unchanged. (BL-465 already sits in `backlog/done/` from its
original ship; this bounce concerns only the post-ship defect fix's commit
lineage, not the backlog folder location, which is coordinator bookkeeping.)
