# Article 4.2 babysitter escalation — false positive (BL-1490, 607e7fc56d)

**Flagged**: 607e7fc56de4f82db66ad1892f8163a10a98a7f5 "BL-1490: tip-pure replay
onto origin/main (BL-1241 land-step remedy)" — touches
`specs/pipeline/steps/bl1490PollPhaseNeverInvisibleSteps.js`,
`specs/pipeline/steps/lib/bl1490TickPhaseFixtureCli.bb`.

**Adjudication**: false positive — QA's land-step tooling wrote a
land-approval record (`.swarmforge/land-approvals/2026-09.jsonl`,
`{"at":"2026-09-08T10:18:41Z","ticket":"BL-1490","commit":"607e7fc56d","source":"9558401764"}`),
and QA sent a `note` to the coordinator: "BL-1490 QA-approved and landed
607e7fc56d - bookkeep and route next" (2026-09-08 10:19:32Z).

`is_qa_ancestor.sh 607e7fc56d` still fails: the named source `9558401764`
is not itself a `swarmforge-QA` ancestor — it only lives on branch
`bl1471-landing`, orphaned by an earlier land attempt of the same ticket
(same shape as [[land-approval-row-can-name-an-orphaned-source-sha]]).

Content review settles it: `git diff 9558401764 607e7fc56d --stat` is
empty — the landed commit is byte-identical to the reviewed source. No
bounce history exists for BL-1490 (`.swarmforge/bounces/`, ticket
`bounce_history`). Nothing unreviewed landed.

**Expected resolution**: self-heals once QA's next `main`→`QA` merge makes
607e7fc56d itself a `swarmforge-QA` ancestor (per BL-1408's identical
2026-09-08 01:44Z incident). Waiving this one key rather than re-recording,
since the fix is time, not a new record.
