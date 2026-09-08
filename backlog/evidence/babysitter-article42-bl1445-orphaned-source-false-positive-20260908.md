# Article 4.2 adjudication — BL-1445 land `5df134812c`, 2026-09-08

Babysitter health sweep flagged `5df134812c90829501fb5f257c3b8ed2e686ae54`
("BL-1445: tip-pure replay onto origin/main (BL-1241 land-step remedy)"),
touching `extension/test/bl1445StaffingGateWiringTestDecidesOverrideInvariants.property.test.js`
and `specs/pipeline/steps/bl1445StaffingGateWiringTestDecidesOverrideSteps.js`.

## Predicate result

`bash swarmforge/scripts/is_qa_ancestor.sh 5df134812c90829501fb5f257c3b8ed2e686ae54`
(direct rc capture, not piped) → **exit 1**:
"not approved: 5df134812c has a land-replay record naming source d3490a7a95,
which is not itself approved (.swarmforge/land-approvals/2026-09.jsonl)".

## This is the orphaned-source pattern, not a real violation

- A land-approval row DOES exist: `{"at":"2026-09-08T03:55:48Z","ticket":"BL-1445","commit":"5df134812c","source":"d3490a7a95"}`.
- `d3490a7a95` sits only on local branch `bl1471-landing`, not on `swarmforge-QA`
  (`git merge-base --is-ancestor d3490a7a95 swarmforge-QA` → not an ancestor).
  It is QA's own build-branch merge commit ("Merge remote-tracking branch
  'origin/main' into bl1471-landing"), reused as the source for this land.
- Content is identical at both flagged paths between the named source and the
  landed commit (`diff <(git cat-file -p d3490a7a95:<path>) <(git cat-file -p
  5df134812c:<path>)` → no diff, for both paths). Nothing unreviewed landed.
- Bounce stores clean for this sha: `.swarmforge/bounces/2026-09.jsonl` has one
  BL-1445 row, but it names commit `5ebca5d530` (architect→coder bounce at
  03:05:38Z) — a different, already-reworked commit (two post-bounce cleaner
  evidence files exist), not `5df134812c` or `d3490a7a95`. Not a veto on this
  sha (same shape as the BL-1399 precedent).
- `swarmforge-QA` merges `origin/main` roughly every 5-10 minutes (reflog:
  04:01, 04:03, 04:08 merges; last one before this land at 04:18:58Z, before
  BL-1445 landed at 04:55:42+01:00/03:55:42Z). Self-heal is expected on QA's
  next such merge, which will make `5df134812c` a `swarmforge-QA` ancestor via
  direct ancestry and clear the predicate without any record change.

## Disposition

False positive, first delivery for this sha. No waive recorded and no note
sent to QA — per the established pattern, action here would just be a QA
land-approval re-record chasing a condition about to resolve itself. Only a
RE-FIRE on this same sha after `swarmforge-QA` has had a chance to merge main
up again would warrant that (BL-1405 recipe). Logged for the babysitter's
records; no further action taken this pass.

By coordinator.
