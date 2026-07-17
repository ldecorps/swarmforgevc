# BL-475-retire-superseded-bl462-grid-slug-scenario — QA bounce 2026-07-17 (blocked by shared commit)

1. **Failing command**: none of BL-475's own — it is blocked because it shares
   commit `35da569b7f` with BL-469, which fails (see
   `BL-469-per-agent-steering-topic-icons-bounce-20260717.md`).

2. **Commit hash checked out and tested**: `494d9b36782eeac82ca560a28aa19853de338e77`
   (QA's merge of documenter commit `35da569b7f`, a combined
   BL-475/BL-477/BL-469 batch — hardener commit `6a8ee5e1` explicitly names
   all three).

3. **First error excerpt**: N/A — BL-475's own scope is independently
   verified CLEAN:
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-462-pipeline-board-wider-slug-updated-at-repost.feature`
     → 7/7 pass. `refine-02` scenario retired with its two step handlers
     removed; `refine-01` correctly LEFT IN PLACE because it still passes
     against landed BL-465 (per the ticket's own build-time re-check
     instruction).
   - Coder commit `bebe4396` diff is confined to the feature file and
     `bl462PipelineBoardRefinementsSteps.js` — no production source touched,
     matching the ticket's scope constraint.
   - Full extension unit suite: 316/316 files, 5066/5066 tests green.

4. **Failure class**: `integration` — not a defect in BL-475's own work; it
   cannot land independently because it is committed together with BL-469's
   defective icon table in the same tree.

5. **Expected vs observed**: Expected — a clean parcel forwards to `main`.
   Observed — the parcel is bounced as a whole because a sibling ticket
   bundled in the same commit fails its own acceptance contract.

## Note
No rework needed for BL-475 itself. Once the coder fixes BL-469's icon
collision (see the BL-469 evidence file) and the batch is re-forwarded
through cleaner/architect/hardener/documenter, BL-475's already-correct
scenario retirement rides along unchanged.
