# Article 4.2 babysitter escalation — false positive (BL-1491, fc5ad74f07)

**Flagged**: fc5ad74f07b5fc5c14d7621c09fa83ed9990fea3 "BL-1491: tip-pure
replay onto origin/main (BL-1241 land-step remedy)" — touches
`specs/pipeline/steps/bl1491HaltRecordsItselfSteps.js`,
`specs/pipeline/steps/lib/bl1491HaltRecordsItselfCli.bb`.

**Adjudication**: false positive — QA's land-step tooling wrote a
land-approval record (`.swarmforge/land-approvals/2026-09.jsonl`, source
`40830d747f`), and QA sent a `note` to the coordinator: "BL-1491
QA-approved, landed fc5ad74f07 - bookkeep and route next"
(2026-09-08 11:34:12Z).

`is_qa_ancestor.sh fc5ad74f07` fails: the named source `40830d747f` is not
itself a `swarmforge-QA` ancestor — it only lives on branch
`bl1471-landing`, orphaned by an earlier land attempt (same shape as
[[land-approval-row-can-name-an-orphaned-source-sha]], and identical to the
same-morning BL-1490/607e7fc56d incident on this same branch).

Content review settles it: `git diff 40830d747f fc5ad74f07 --stat` is
empty — byte-identical. No bounce history exists for BL-1491.

**Expected resolution**: self-heals once QA's next `main`→`QA` merge makes
fc5ad74f07 itself a `swarmforge-QA` ancestor. Waiving this one key rather
than re-recording, since the fix is time, not a new record.
