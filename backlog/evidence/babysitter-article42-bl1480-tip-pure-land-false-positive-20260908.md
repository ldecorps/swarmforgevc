# Article 4.2 adjudication — BL-1480 tip-pure land, false positive

**Flagged commit:** `e274174322776d669eca71a3dff00bcf1ee7a61c` "BL-1480: tip-pure
replay onto origin/main (BL-1241 land-step remedy)", touching
`specs/pipeline/steps/bl1480PromoteRouteFixtureClosureSteps.js` and
`specs/pipeline/steps/lib/bbFixtureClosureGate.js`.

**Verdict: FALSE POSITIVE.** Known BL-1241 tip-pure-land ancestry race
(see `[[article42-predicate-is-ancestry-only-qa-handland-always-flags]]`)
compounded by an orphaned/not-yet-merged land-approval source
(`[[land-approval-row-can-name-an-orphaned-source-sha]]`).

## Evidence

- `is_qa_ancestor.sh e274174322` → exit 1, "land-replay record naming source
  de5b6aa6cc, which is not itself approved".
- Land-approval row: `.swarmforge/land-approvals/2026-09.jsonl:100`
  `{"ticket":"BL-1480","commit":"e274174322","source":"de5b6aa6cc"}`.
- `de5b6aa6cc` = QA's own tip commit ("BL-1480: remove register rows, standing
  tests are green"), built directly on `b34dba24fc` (documenter's commit that
  QA's evidence file names as "Approved for landing on documenter commit
  b34dba24fc"). QA evidence (`backlog/evidence/BL-1480-QA-20260908.md`)
  records an explicit NONE — full checklist run, no defect.
- Blob-SHA compare of both flagged paths, source vs landed — **identical**:
  - `bl1480PromoteRouteFixtureClosureSteps.js`: `d51f72b98890ac020b8e6fd4268b3c278b897fbd` both sides
  - `bbFixtureClosureGate.js`: `0b51878811fb19a84d6e80a1300470f9d5a2d50f` both sides
  - The only diff between `de5b6aa6cc` and `e274174322` trees is
    `backlog/topics/BL-1480.json` (bookkeeping), consistent with a tip-pure
    own-paths replay.
- `de5b6aa6cc` is not yet an ancestor of `swarmforge-QA` (exit 1) or of
  `origin/main` (exit 1) — it lives only on worktree branches
  (architect/cleaner/documenter/hardender), i.e. it was never a merge
  target, only a content reference for the tip-pure replay. This is the
  expected shape of the BL-1241 recipe, not a drop.
- `swarmforge-QA` is only 2 commits behind `main` — small, ordinary lag;
  expected to self-heal on QA's next merge-up.
- No bounce: `.swarmforge/bounces/` has no file naming this sha or BL-1480;
  ticket YAML carries no `bounce_history`.

## Action taken

None beyond this record — per policy, take no action on first delivery for
a fresh (<10 min old, landed 2026-09-08T05:33:39Z) tip-pure land finding;
content is proven byte-identical to QA's reviewed tip. Re-check only if this
subject re-fires.

By coordinator.
