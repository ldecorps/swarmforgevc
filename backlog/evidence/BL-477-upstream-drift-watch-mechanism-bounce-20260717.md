# BL-477-upstream-drift-watch-mechanism — QA bounce 2026-07-17 (blocked by shared commit)

1. **Failing command**: none of BL-477's own — it is blocked because it shares
   commit `35da569b7f` with BL-469, which fails (see
   `BL-469-per-agent-steering-topic-icons-bounce-20260717.md`).

2. **Commit hash checked out and tested**: `494d9b36782eeac82ca560a28aa19853de338e77`
   (QA's merge of documenter commit `35da569b7f`, a combined
   BL-475/BL-477/BL-469 batch — hardener commit `6a8ee5e1` explicitly names
   all three).

3. **First error excerpt**: N/A — BL-477's own scope is independently
   verified CLEAN:
   - `specs/pipeline/scripts/run_acceptance.sh
     specs/features/BL-477-upstream-drift-watch-check.feature` → 4/4 pass
     (advanced-branch drift, no-drift, new-branch drift, read-only
     never-rewrites).
   - Coder commit `e146a714` adds `upstream-watch.json`,
     `swarmforge/scripts/upstream_drift_check.bb` +
     `upstream_drift_check_lib.bb`, `docs/upstream-deviations.md`, and their
     unit/shell tests — confined to the ticket's declared scope, no
     unrelated production source touched.
   - Full extension unit suite: 316/316 files, 5066/5066 tests green.

4. **Failure class**: `integration` — not a defect in BL-477's own work; it
   cannot land independently because it is committed together with BL-469's
   defective icon table in the same tree.

5. **Expected vs observed**: Expected — a clean parcel forwards to `main`.
   Observed — the parcel is bounced as a whole because a sibling ticket
   bundled in the same commit fails its own acceptance contract.

## Open note (not gating, flagged for the record)
BL-477's own `human_approval:` field states the new feature file is
"flagged for human review (specifier draft, NOT yet human-approved)" —
awaiting human confirmation that (a) the seeded baseline SHAs are
acceptable and (b) the read-only/never-auto-adopt posture is correct. The
ticket nonetheless reached `backlog/active/` and ran the full pipeline to
QA. This is a promotion-policy question for the specifier/coordinator, not
a functional defect QA can verify or gate on — noted here for visibility
only. The built mechanism does match its own read-only contract (scenario 4
confirms no fetch/merge/pin-bump), which is the part QA can and did verify.

## Note
No rework needed for BL-477 itself. Once the coder fixes BL-469's icon
collision (see the BL-469 evidence file) and the batch is re-forwarded
through cleaner/architect/hardener/documenter, BL-477's already-correct
drift-watch mechanism rides along unchanged.
